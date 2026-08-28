# NotaryBuddy

Ein Agent liest Grundbuchauszüge in einen strukturierten Urkunden-Datensatz — unter
Aufsicht. Jedes Feld trägt eine Konfidenz und eine Fundstelle im Auszug. Was der Agent
nicht sicher lesen kann, markiert er, statt es zu raten. Der Entwurf entsteht erst, wenn
ein Mensch die kritischen Felder bestätigt hat, und zwar serverseitig erzwungen.

---

## Start

Gebraucht werden Node 20+, Docker und ein eigener Anthropic-API-Key. Den
Google-Vision-Schlüssel schicke ich per E-Mail; im Repo liegen keine Secrets.

1. `docker compose up -d` — startet Postgres.
2. `cp .env.example .env.local`, dann den eigenen `ANTHROPIC_API_KEY` eintragen.
3. Die `vision-sa.json` aus der E-Mail nach `.gcp/vision-sa.json` kopieren.
4. `npm install && npm run db:migrate && npm run dev`

App unter http://localhost:3000. Ein PDF aus `samples/` hochladen, unter **Agentenlauf**
die Extraktion starten, dann unter **Prüfung** bestätigen oder korrigieren und unter
**Freigabe** den Entwurf erzeugen.

### Testmaterial

| Datei | Wofür |
|---|---|
| `muster-grundbuchauszug.pdf` | Echtes, anonymisiertes Muster. Unordentlicher Scan, echte OCR-Fehler, ein **nur durch Unterstreichung** gelöschter Eigentümer |
| `synthetic-erbengemeinschaft.pdf` | Vier Eigentümer, einer gelöscht, eine gelöschte Hypothek |
| `synthetic-zwangsversteigerung.pdf`, `synthetic-wohnungseigentum.pdf`, `synthetic-erbbaurecht.pdf` | Weitere Konstellationen |
| `*-scan.pdf` | Künstlich verrauschte Varianten; `synthetic-unlesbar-scan.pdf` ist der bewusste OCR-Fehlerfall |

Zu jedem synthetischen Auszug liegt eine `.truth.json` mit den erwarteten Werten.

---

## Die Schleife

`src/lib/agent/run.ts` — `ToolLoopAgent` (AI SDK v7), temperature 0, harte Grenze bei 40
Schritten. Der Agent entscheidet selbst, was als Nächstes passiert; es gibt keine
vorgegebene Reihenfolge.

| Werkzeug | |
|---|---|
| `list_pages` | Welche Seiten gibt es, welche sind schon gelesen |
| `ocr_page` | Google Vision auf eine Seite; Fehler kommen als strukturierter Fehlercode zurück, nie als leeres Ergebnis |
| `get_page_text` | Der rekonstruierte Seitentext |
| `view_page` | Das Seitenbild — kein Extra, sondern der einzige Kanal für Streichungen |
| `record_fields` | Werte eintragen, jeder mit Zitat |
| `flag_field` | „Der Auszug gibt das nicht her" — ein zulässiges Ergebnis |
| `check_completeness` | Was fehlt noch |

`check_completeness` ist das, was die Schleife zu einer Schleife macht: der Agent liest die
Lückenliste und entscheidet, ob er eine weitere Seite liest, ein Bild ansieht oder aufhört.

**Verworfen: ein einziger Structured-Output-Call.** Billiger und auf sauberen Dokumenten
ausreichend, aber er kann nicht nachfassen. Er kann eine Seite nicht ein zweites Mal
ansehen, weil ihm eine Zeile unklar war, und er kann nicht merken, dass ihm nach zwei
Seiten Abteilung III fehlt. Die Aufgabe schließt ihn außerdem ausdrücklich aus.

**Verworfen: OCR als Pipeline-Schritt vor dem Agenten.** Dann ist ein Lesefehler eine
stille Vorbedingung. Als Werkzeug im Loop wird er zu einem Ereignis, auf das der Agent
reagieren muss — und der Lauf schlägt sichtbar fehl, statt einen halb gelesenen Auszug als
vollständigen Datensatz auszugeben.

**Verworfen: Tesseract als Fallback.** Ein zweiter, schlechterer Leseweg degradiert leise
und wird später als Agentenfehler fehlgedeutet. Es gibt genau einen OCR-Pfad; ist er nicht
verfügbar, bricht die App laut ab.

### Quellenangaben

Der Agent liefert nur den Wortlaut, den er zitiert — der Server sucht die Stelle selbst und
lehnt ab, was nicht auf der Seite steht oder mehrdeutig ist. Ein Wert ohne prüfbares Zitat
lässt sich technisch nicht eintragen.

**Verworfen: der Agent nennt Zeichenpositionen.** Erst so gebaut; *jede* abgelehnte
Zitation in den ersten Läufen war ein verzählter Offset, nie ein falsches Zitat. Das Modell
zählt keine Zeichen, also zählt es der Server.

Für die Anzeige wird die Fundstelle nachträglich auf die Wörter verengt, die den Wert
tragen (`boxesForValue`). Der Agent zitiert ganze Tabellenzeilen, weil kürzere Zitate auf
einer Grundbuchseite oft mehrdeutig sind — gespeichert bleibt, was er behauptet hat, die
Anzeige zeigt trotzdem genau die Zelle.

---

## Gelöschte Einträge werden gemessen, nicht erkannt

Der interessanteste Befund des Projekts. Im Muster ist der frühere Eigentümer
ausschließlich durch **Unterstreichung** als gelöscht markiert. Im OCR-Text ist er vom
aktuellen Eigentümer nicht zu unterscheiden — eine reine Textextraktion meldet einen
abgelösten Eigentümer als den heutigen. Genau der stille Fehler, um den es in der Aufgabe
geht.

Zwei Läufe desselben Modells bei temperature 0 lieferten für dieses Feld `geloescht` (0.94)
und `aktiv` (0.94). Die Konfidenz trug null Information.

Deshalb ist die Streichung keine Wahrnehmung des Modells, sondern eine Messung
(`src/lib/ocr/marks.ts`): unter jeder Zelle wird die Pixelzeile abgetastet, und eine
Unterstreichung wird von einer Tabellenlinie dadurch getrennt, dass die Tabellenlinie in die
Spaltenzwischenräume weiterläuft. Das Ergebnis steht als `[unterstrichen]` im Seitentext;
der System-Prompt sagt dem Agenten, dass die Messung maßgeblich ist, nicht sein Eindruck
vom Bild.

Das hat mich selbst erwischt: eine frühere Fassung schätzte die Zeilenneigung pro Zeile
statt pro Seite. Auf einer dreiwortigen Zelle liefert die Ausgleichsgerade durch die
Wortmitten rund ein Grad Neigung auf einer Seite ohne jede Schräglage — genug, um die
Randproben von einer zwei Pixel dünnen Tabellenlinie zu schieben. Drei aktive Eigentümer
wurden als gelöscht gemeldet. Eine Seite hat eine Schräglage; sie wird jetzt einmal
gemessen (Median über die dafür langen Zeilen).

---

## Nicht-Determinismus

Der Agent ist nicht deterministisch und wird es nicht. Die Antwort ist nicht, Determinismus
vorzutäuschen, sondern jede Aussage überprüfbar zu machen:

- **Was schwankt, ist belegt.** Jeder Wert hat ein serverseitig verifiziertes Zitat.
- **Was liability-relevant und messbar ist, wird gemessen.** Streichungen kommen aus der
  Pixelmessung, nicht aus dem Modell.
- **Unsicherheit propagiert.** Die Feldkonfidenz ist das Minimum der OCR-Konfidenz über die
  Wörter, die den Wert tragen. Unter 0.8 wird das Feld markiert statt ausgegeben.
- **Der Entwurf ist deterministisch.** `renderDraft` ist eine reine Funktion über bestätigte
  Werte — kein zweiter Modellaufruf berührt das Dokument, das rechtliche Wirkung entfaltet.
- **Die Gates hängen an Menschen, nicht an Konfidenzwerten.**

Die Konfidenz zu skalieren war Arbeit, keine Kosmetik. Vision spaltete am Ende einer „3"
ein Phantom-Komma mit Konfidenz 0.43 ab — der schlechteste Wert der ganzen Seite. Da die
Konfidenz das Minimum über das *ganze* zitierte Zeilenzitat war, markierte dieses
5-Pixel-Artefakt alle vier Felder dieser Zeile. Jetzt zählt nur, was den Wert selbst trägt;
für `status`, dessen Wert überhaupt nicht im Text steht, zählt stattdessen die Lesbarkeit
der Zeile (Median statt Minimum, damit ein Artefakt sie nicht kippt).

---

## Freigabe-Gates

Kritisch sind Eigentümer, Abteilung II und Abteilung III — jedes Feld darin braucht eine
menschliche Entscheidung. Die Prüfung sitzt in `POST /api/documents/:id/draft`, nicht im
Client:

```bash
curl -i -X POST localhost:3000/api/documents/<id>/draft
```

```
HTTP/1.1 403 Forbidden
{"error":"Freigabe verweigert: nicht alle kritischen Felder sind bestätigt.",
 "gate":{"open":false,"blockers":[{"kind":"field","reference":"eigentuemer[0].name",
 "reason":"noch nicht bestätigt"}, …]}}
```

Nach Bestätigung aller kritischen Felder antwortet derselbe Aufruf mit `201` und dem
Entwurf. Ungelesene oder fehlgeschlagene Seiten blockieren ebenfalls: ein nur teilweise
gelesener Auszug kann keinen vollständigen Entwurf ergeben.

„Nicht angegeben" ist dabei eine gültige Entscheidung. Ein Alleineigentümer hat keinen
Miteigentumsanteil; ohne diesen Weg müsste die Prüferin einen Wert erfinden, um das Gate zu
öffnen — genau das Raten, das die App verhindern soll.

---

## Audit-Log

Append-only (`events`), im Dokument einsehbar. Geschrieben wird das Ereignis *vor* der
Feldänderung: schlägt das Update fehl, steht der Versuch trotzdem im Log.

Jede Zeile trägt Urheber (`agent:<runId>`, `judge:<runId>`, `user`, `system`), Aktion, alten
und neuen Wert, Zeitpunkt und Beleg. Eine Sammelbestätigung ist dabei kein Sonderfall,
sondern *n* einzelne Bestätigungen mit je einem Ereignis — im Log ist sie von *n* einzelnen
Klicks nicht zu unterscheiden, weil sie es nicht ist.

---

## Wo KI half und wo ich ihr widersprochen habe

Gebaut mit Claude Code, durchgängig — Schema, Schleife, OCR-Geometrie, Oberfläche. Die
Stellen, an denen ich das Vorgeschlagene verworfen habe, waren die aufschlussreichen:

- **SQLite statt Postgres**, weil setup-frei. Abgelehnt: ihr fahrt Postgres, und ein
  Take-home, das den Datastore gegen etwas Bequemeres tauscht, testet weniger als es
  scheint. Kostet einen zusätzlichen Startbefehl.
- **Tesseract als OCR-Fallback**, falls Vision nicht erreichbar ist. Abgelehnt: ein
  zweiter, schlechterer Leseweg degradiert leise und wird später als Agentenfehler
  fehlgedeutet. Es gibt genau einen Pfad; fällt er aus, bricht die App laut ab.
- **Vision über handgeschriebenes REST**, um eine Abhängigkeit zu sparen. Abgelehnt:
  Token-Refresh und Retries sind gelöste Probleme, das offizielle SDK bleibt.
- **Werte normalisieren** — Datumsformate vereinheitlichen, Beträge in Zahlen wandeln.
  Abgelehnt: `180.000,00` bleibt `180.000,00`. Ein Entwurf, der die Schreibweise des
  Registers still ändert, ist bereits eine unbemerkte Änderung.
- **Zitate über Zeichenpositionen** — meine eigene erste Fassung, vom Modell übernommen.
  *Jede* abgelehnte Zitation der ersten Läufe war ein verzählter Offset, nie ein falsches
  Zitat. Jetzt liefert der Agent nur den Wortlaut, der Server sucht die Stelle.

Umgekehrt: der Anstoß, das Seitenbild als Werkzeug in die Schleife zu geben statt nur Text
zu reichen, kam aus einer Modell-Anregung — und wurde zum Fundament der
Streichungserkennung. Und die Entscheidung, `flagged` als regulären Schemazustand zu führen
statt als Fehler, hat die Anti-Rate-Logik erst sauber gemacht: „ich weiß es nicht" ist ein
zulässiges Ergebnis, kein Ausnahmefall.

Was durchweg nicht funktionierte, war, dem Modell zu glauben, wenn es sich sicher gab. Der
Konfidenzwert unterschied bei der Streichungserkennung nichts (0.94 für beide Antworten),
und drei der interessantesten Fehler dieses Projekts fand nicht ein Testlauf, sondern das
Nachrechnen einer Zahl, die plausibel aussah.

## Mit einer Woche mehr

1. **Zitat muss den Wert enthalten.** Der Server prüft heute, dass das Zitat auf der Seite
   steht, nicht dass es den Wert *trägt*. In einem Lauf belegte die Grundlage der Eintragung
   eines Eigentümers dessen Namenszelle — richtiger Wert, falscher Beleg. Regel: steht der
   Wert wörtlich irgendwo auf der Seite, muss er im Zitat liegen; abgeleitete Werte bleiben
   ausgenommen.
2. **Judge-Agent sichtbar machen.** Läuft (`runJudge`, eigener Lauf, eigenes Modell, frischer
   Kontext, eskaliert bei Widerspruch zurück auf `flagged`), ist aber nur über
   `POST /api/documents/:id/judge` erreichbar. Der richtige Platz ist die Freigabe: nach der
   menschlichen Bestätigung, vor dem Entwurf.
3. **Fotos vom Handy.** Heute nur PDF. Entzerrung und Beschnitt vorschalten, dann trägt
   dieselbe Pipeline.
4. **Höhere Rasterung.** 144 dpi ist für Vision genug, aber die Bildausschnitte in der
   Prüfung könnten schärfer sein.
5. **Unicode-Font im PDF.** Die Standardschriften decken WinAnsi ab; alles darüber wird
   sichtbar zu `?` ersetzt statt still verschluckt.
6. **Regressionstests gegen die `.truth.json`** als Skript statt von Hand.

---

## Kosten

Pro fünfseitigem Auszug: **~0,65–0,75 $** mit Sonnet 5, **~0,15 $** mit Haiku 4.5 (im
Agentenlauf umschaltbar, die laufenden Kosten stehen live über dem Protokoll). Sonnet 5
trifft auf `synthetic-erbengemeinschaft.pdf` reproduzierbar 40 von 40 Feldern der
Ground-Truth; Haiku extrahierte im selben Dokument Einträge, die es nicht gibt. Die
Gesamtkosten der Entwicklung liegen deutlich unter den 10 €.

## Bekannte Grenzen

- Kein Judge in der Oberfläche (siehe oben).
- Der Extraktionsumfang deckt Aufschrift, Bestandsverzeichnis, Abteilung I–III ab, nicht
  jede Spalte jeder Form.
- Der Entwurf ist eine Vorlage, kein Urkundentext — er zeigt, dass nur bestätigte Werte
  hineinlaufen.
