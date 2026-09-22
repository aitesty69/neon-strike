# NEON STRIKE — Browser FPS 5v5

To jest grywalny prototyp przeglądarkowej strzelanki 3D. Nie używa gotowych modeli 3D: arena, postacie i broń są generowane z prostych brył Three.js.

## Co jest w prototypie

- 3D FPS w przeglądarce
- lobby z kodem pokoju
- udostępniany link `/?room=ABC123`
- max 5v5
- wybór drużyny
- automatyczne uzupełnienie składów botami
- losowo generowana mapa z osłonami
- blokada wejścia na wrogi spawn
- blokada strzału przez / do stref spawnu
- 10 sekund kupowania
- 60 sekund rundy
- eliminacja całej drużyny kończy rundę
- mecz do 10 wygranych rund
- powrót do tego samego lobby po meczu
- `PLAY AGAIN`
- ekonomia między rundami
- +300$ za zabójstwo
- wygrana rundy: +3000$
- bonus za przegraną serię: 1400 / 1900 / 2400 / 2900 / 3400$
- zakup broni:
  - Pistol — darmowy
  - Galil — 2000$
  - AK-47 — 2700$
  - Sniper — 4750$
  - Frag — 300$
- obrażenia:
  - karabiny: 20 body / 80 head
  - pistolet: 15 body / 90 head
  - snajper: 95 body / 100 head
- broń zachowana po przeżyciu rundy; śmierć usuwa primary i granaty

## Uruchomienie na Windows

Potrzebujesz Node.js 20+.

W folderze projektu:

```bash
npm install
npm start
```

Potem otwórz:

```text
http://localhost:3000
```

## Jak zagrać ze znajomym przez internet

Ten projekt potrzebuje serwera Node.js, bo lobby i multiplayer korzystają z Socket.IO. Samo wrzucenie `index.html` na zwykły hosting statyczny nie wystarczy.

Na hostingu, który uruchamia aplikacje Node.js:

1. wrzuć cały projekt,
2. uruchom `npm install`,
3. ustaw komendę startową `npm start`,
4. hosting poda publiczny adres HTTPS,
5. otwierasz adres,
6. tworzysz lobby,
7. klikasz `KOPIUJ LINK`,
8. wysyłasz link koledze.

Socket.IO korzysta z połączenia dwukierunkowego i może użyć WebSocket; w razie braku WebSocket ma mechanizm fallbacku HTTP long-polling. Three.js jest ładowany jako moduł biblioteki 3D w przeglądarce.

## Sterowanie

- WASD — ruch
- Shift — sprint
- mysz — rozglądanie
- LPM — strzał
- 1 — pistolet
- 2 — AK-47
- 3 — Galil
- 4 — snajper
- R — przeładuj
- G — granat

## Ważne

To jest prototyp gry, a nie produkcyjny shooter klasy Call of Duty. Multiplayer jest celowo prosty. Przed publikacją publiczną należałoby dodać m.in. walidację anty-cheat, lepszą interpolację/predykcję sieciową, prawdziwe modele/animacje, dźwięki, lepszą fizykę pocisków, reconnect, prywatność pokoi i limity serwera.
