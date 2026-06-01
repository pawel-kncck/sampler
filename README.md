# Konsola dźwięków — Dzień Dziecka 4c

Jednoplikowa aplikacja webowa (`index.html`), która działa jak prosty sampler i jednocześnie suflerka scenariusza. Powstała jako prezent rodziców i wychowawczyni dla uczniów klasy 4c — do obsługi efektów dźwiękowych podczas występu *„Szkoła oczami uczniów… czyli totalny chaos!”*.

Cały scenariusz wyświetla się po lewej stronie, a po prawej operator ma listę padów i wskaźnik „następny dźwięk”. W trakcie spektaklu wystarczy naciskać **Spację** w odpowiednich momentach — strona sama prowadzi przez kolejne sygnały.

## Co potrafi

- **Scenariusz na ekranie** — pełny tekst sztuki z wyróżnionymi miejscami, w których pada efekt dźwiękowy (pomarańczowe „chipy” z numerem pada).
- **Sampler 14 padów** — każdy dźwięk ma przypisany klawisz (`1`–`9`, `0`, `-`, `=`, `Q`, `W`) oraz kafelek do kliknięcia.
- **Tryb występu (domyślny)** — Spacja gra następny dźwięk w kolejności scenariusza, strzałki przewijają wskaźnik bez grania, Esc zatrzymuje wszystko.
- **„Następny dźwięk”** — duży banner po prawej pokazuje, co zagra po naciśnięciu Spacji, oraz podpowiada, co będzie zaraz potem.
- **Tryb edycji** — przełącznik „✏️ Tryb edycji” pozwala poprawić tekst scenariusza na żywo; zmiany zapisują się w `localStorage` przeglądarki. Przycisk „↺ Przywróć oryginalny tekst” cofa wszystko do wersji wgranej w pliku.
- **Brak pliku? Wgraj z dysku** — dla sygnałów bez gotowego nagrania (np. „muzyczka”) w prawej kolumnie jest sekcja „Do odtworzenia ręcznie”, gdzie można podpiąć dowolny plik audio z dysku tylko na czas występu.
- **Suwak głośności i pasek postępu** — głośność master + aktualny czas odtwarzania bieżącego sampla.

## Skróty klawiszowe

| Klawisz | Działanie |
|---|---|
| `Spacja` / `Enter` | Zagraj następny dźwięk z kolejki scenariusza |
| `↑` / `↓` | Przesuń wskaźnik „następny dźwięk” bez grania |
| `1`–`9`, `0`, `-`, `=`, `Q`, `W` | Zagraj konkretny pad |
| `Esc` | Natychmiast zatrzymaj wszystko |

W trybie edycji skróty są wyłączone, żeby można było swobodnie pisać.

## Uruchomienie

Aplikacja jest w 100% statyczna — żadnego buildu, żadnego backendu.

- **Lokalnie**: otwórz `index.html` w przeglądarce. Przy plikach `file://` niektóre przeglądarki blokują autoplay — wystarczy kliknąć cokolwiek na stronie, żeby odblokować dźwięk. Najwygodniej puścić prosty serwer, np. `python3 -m http.server 8000` w katalogu projektu i wejść na `http://localhost:8000`.
- **Online**: repozytorium ma workflow GitHub Actions (`.github/workflows/static.yml`), który publikuje całą zawartość na GitHub Pages przy każdym pushu do `main`.

## Struktura repo

```
index.html                  ← cała aplikacja (HTML + CSS + JS w jednym pliku)
samples/                    ← pliki .mp3 podpięte do padów
  01_crickets.mp3
  02_wah-wah-wah.mp3
  …
  happy.mp3                 ← finałowa piosenka „Happy” (Pharrell Williams)
  _raw/                     ← surowe nagrania (ignorowane przez git)
Scenariusz_DD_4c.docx       ← źródłowy scenariusz w Wordzie
Scenariusz_DD_4c.pdf        ← scenariusz w PDF (do druku)
sound-sampler-prd.md        ← pierwotny PRD samplera
.github/workflows/static.yml ← deploy na GitHub Pages
```

## Jak podmienić dźwięki lub edytować scenariusz

- **Tekst scenariusza** — najszybciej przez tryb edycji w przeglądarce (zapis lokalny), a docelowo bezpośrednio w `index.html`, w sekcji `<div class="script-inner">`. Każdy efekt dźwiękowy to `<span class="cue" data-cue="ID">` w linijce `<p class="cue-line">`.
- **Pady i pliki dźwiękowe** — lista wszystkich sygnałów jest w tablicy `CUES` w `<script>` na dole `index.html`. Pole `file` wskazuje plik z katalogu `samples/`; `pad` i `key` definiują numer pada i klawisz. Wpisy z `file: null` traktowane są jako „do odtworzenia ręcznie”.
- **Nowy dźwięk** — wrzuć plik do `samples/`, dodaj wpis do `CUES` z unikalnym `id`, a w odpowiednim miejscu scenariusza wstaw `<p class="cue-line"><span class="cue" data-cue="TWOJE_ID" contenteditable="false"></span></p>`.

## Stack

Plain HTML + CSS + vanilla JS, jeden plik, bez zależności i bez kroku buildu. Audio przez element `<audio>` (jeden dźwięk na scenie naraz, każdy nowy trigger zatrzymuje poprzedni). Stan (ostatnio wskazany cue, głośność, edytowany tekst) zapisywany w `localStorage`.
