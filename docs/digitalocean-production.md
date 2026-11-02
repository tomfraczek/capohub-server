# CapoHub API – produkcja na DigitalOcean App Platform

Instrukcja do pierwszego (i kolejnych) wdrożeń `capohub-server` na DigitalOcean App Platform.
Zakłada aplikację `capohub-app` w projekcie `capohub`, region **FRA1**, branch `main` z autodeployem, buildpack Node.js (bez Dockera).

Rzeczy, których nie da się ustalić z repozytorium (nazwy zasobów, rozmiary, wartości sekretów), są oznaczone **[panel]**.

---

## 1. Architektura w skrócie

| Komponent | Typ | Build | Run |
|---|---|---|---|
| `capohub-server` | Web Service | `yarn build` | `yarn start:prod` |
| `capohub-db` | Managed PostgreSQL (FRA1) | – | – |

Nie ma komponentu Job – migracje wykonuje sam backend przy starcie.

Przebieg każdego deploymentu:

1. Build: `yarn install` + `yarn build`.
2. Nowy kontener startuje `yarn start:prod` (`node dist/main`):
   1. Nest tworzy aplikację i łączy się z bazą (TLS z weryfikacją CA);
   2. **oczekujące migracje MikroORM są aplikowane** (`src/main.ts` → `applyPendingMigrations`, `src/database/migrate.ts`);
   3. dopiero potem `app.listen(8080)` – start obsługi HTTP i zadań cyklicznych (cron).
3. Health check `/api/v1/health` przechodzi → ruch przełącza się na nową wersję.

Zachowanie migracji przy starcie:

| Sytuacja | Efekt |
|---|---|
| Brak nowych migracji | log `No pending migrations - database is up to date`, normalny start |
| Nowe migracje | log `Applying N pending migration(s): …` → `Applied N migration(s)` → start |
| Błąd migracji | log `ERROR [Bootstrap] Startup migrations failed - not starting the HTTP server: …`, zamknięcie połączeń, **kod wyjścia 1**; port nie jest otwierany, schemat bez zmian (wszystkie oczekujące migracje idą w jednej transakcji) |
| Błąd połączenia z bazą (np. zły CA) | `ERROR [ExceptionHandler] …`, kod wyjścia 1 – jeszcze przed migracjami |

Seedy **nigdy** nie uruchamiają się automatycznie. Testy (unit/e2e) nie uruchamiają migracji – nie korzystają z `main.ts`.

---

## 2. Managed PostgreSQL

1. **Create → Databases → PostgreSQL**, region **FRA1**, projekt `capohub`. Wersja i rozmiar: **[panel]**.
2. W aplikacji `capohub-app`: **Add Resource → Database → istniejący klaster**. Nazwa komponentu (np. `capohub-db`) to `<db>` w zmiennych poniżej.
   Dołączenie bazy do aplikacji udostępnia zmienne `${<db>.DATABASE_URL}` i `${<db>.CA_CERT}` oraz dodaje aplikację do *Trusted Sources* bazy – sprawdź to w ustawieniach bazy **[panel]**.
3. Trusted Sources: tylko `capohub-app` (+ tymczasowo Twój IP, jeśli kiedykolwiek łączysz się lokalnie – usuń go zaraz potem).
4. Backupy: Managed PostgreSQL ma automatyczne backupy – sprawdź retencję i możliwość przywrócenia w **[panel]**.

### SSL i certyfikat CA

DigitalOcean podpisuje certyfikaty bazy własnym CA projektu, którego Node nie ma w domyślnym magazynie zaufania. Backend:

- przy `DATABASE_SSL=true` **zawsze** weryfikuje certyfikat serwera (`rejectUnauthorized: true`) – nie ma trybu bez weryfikacji;
- weryfikuje względem `DATABASE_CA_CERT` (PEM wieloliniowy albo z literalnymi `\n`);
- w `NODE_ENV=production` **odmawia startu**, jeśli: `DATABASE_SSL≠true`, brak/niepoprawny `DATABASE_CA_CERT`, albo `DATABASE_URL` wskazuje na `localhost`/`127.0.0.1`/`::1`.

Parametr `?sslmode=require` w `DATABASE_URL` od DigitalOcean jest **ignorowany** przez MikroORM – o TLS decydują wyłącznie `DATABASE_SSL` i `DATABASE_CA_CERT` (`src/database/mikro-orm-options.factory.ts`).

Ustaw: `DATABASE_CA_CERT=${<db>.CA_CERT}`. Przy ręcznym wklejaniu certyfikatu (np. do lokalnego shella): **Databases → `<db>` → Connection details → Download CA certificate**.

### `DATABASE_URL` publiczny czy prywatny (VPC)?

Zacznij od `${<db>.DATABASE_URL}`. Kod przyjmuje dowolny URL `postgresql://`, więc przejście na adres prywatny (VPC) to wyłącznie zmiana wartości zmiennej. Zanim to zrobisz, sprawdź w panelu:
- czy aplikacja i baza są w tej samej VPC i jaką nazwę ma zmienna z prywatnym URL **[panel]**;
- czy certyfikat serwera obejmuje prywatny hostname – wystarczy wdrożyć i sprawdzić start (przy niezgodności hosta backend zakończy się błędem TLS, nie połączy się po cichu bez weryfikacji).

---

## 3. Zmienne środowiskowe

Ustaw na Web Service `capohub-server` (albo jako App-Level Environment Variables – przy jednym komponencie to bez różnicy). Zakres (scope): **Run time** – build ich nie potrzebuje (w szczególności nie ustawiaj `NODE_ENV=production` dla build time, żeby instalacja nie pominęła devDependencies potrzebnych do `nest build`).

| Zmienna | Wartość | Encrypt |
|---|---|---|
| `NODE_ENV` | `production` | nie |
| `PORT` | `8080` | nie |
| `CORS_ORIGINS` | co najmniej jeden URL, np. `${APP_URL}` dopóki nie ma domeny web **[panel – sprawdź, czy `${APP_URL}` jest rozwijane]** | nie |
| `DATABASE_URL` | `${<db>.DATABASE_URL}` | **tak** |
| `DATABASE_SSL` | `true` | nie |
| `DATABASE_CA_CERT` | `${<db>.CA_CERT}` | nie (certyfikat publiczny) |
| `CLERK_SECRET_KEY` | `sk_live_…` (instancja produkcyjna; ta sama co w aplikacji mobilnej) | **tak** |
| `R2_ENDPOINT` | `https://<account_id>.r2.cloudflarestorage.com` | nie |
| `R2_BUCKET` | nazwa bucketu produkcyjnego | nie |
| `R2_PUBLIC_URL` | publiczny URL bucketu | nie |
| `R2_ACCESS_KEY_ID` | klucz tokenu R2 | **tak** |
| `R2_SECRET_ACCESS_KEY` | sekret tokenu R2 | **tak** |

Nie ustawiaj (mają bezpieczne wartości domyślne / są opcjonalne): `API_PREFIX` (`api`), `API_VERSION` (`v1`), `CLERK_PUBLISHABLE_KEY`, `CLERK_JWT_KEY`, `CLERK_AUTHORIZED_PARTIES`, `PUBLIC_WEB_BASE_URL` (dopóki nie ma domeny).

`CLERK_SECRET_KEY` z prefiksem `sk_test_` przy `NODE_ENV=production` nie blokuje startu, ale w logach pojawi się ostrzeżenie `[Bootstrap] NODE_ENV=production is using a Clerk development instance key`.

---

## 4. Web Service `capohub-server`

| Ustawienie | Wartość |
|---|---|
| Source | GitHub `tomfraczek/capohub-server`, branch `main`, **autodeploy włączony** |
| Build strategy | Buildpack (Node.js) – wersja z `package.json` → `engines.node: 22.x` |
| Build command | `yarn build` |
| Run command | `yarn start:prod` |
| HTTP port | `8080` |
| Instance count | `1` – patrz sekcja 9 (migracje nie mają blokady między instancjami) |
| Instance size | **co najmniej 1 GB RAM** **[panel]** – sam proces w spoczynku zajmuje ok. 450 MB RSS (zbiór miast geonames jest ładowany przy starcie) |

### Health check

| Ustawienie | Wartość |
|---|---|
| Type | HTTP |
| Path | `/api/v1/health` |
| Initial delay | `30` s |
| Period | `10` s |
| Timeout | `5` s |
| Failure threshold | `6` |

Endpoint jest publiczny i sprawdza połączenie z bazą: `200 {"status":"ok",…,"database":{"status":"up"}}`, przy niedostępnej bazie `503`.

Port otwiera się dopiero **po** migracjach, więc czas migracji wlicza się w okno health checku (initial delay + period × failure threshold ≈ 90 s). Pierwszy deployment (90 migracji na pustej bazie) mieści się w nim z dużym zapasem. Jeśli kiedyś pojawi się migracja trwająca dłużej (np. przebudowa dużej tabeli), na czas tego deploymentu zwiększ initial delay.

### Fragment App Spec (opcjonalnie, zamiast klikania)

Settings → App Spec → Edit. **Nie wklejaj całości w miejsce istniejącego specu** – porównaj i uzupełnij sekcję serwisu. `<db>` i `instance_size_slug` uzupełnij wartościami z panelu.

```yaml
services:
  - name: capohub-server
    github:
      repo: tomfraczek/capohub-server
      branch: main
      deploy_on_push: true
    environment_slug: node-js
    build_command: yarn build
    run_command: yarn start:prod
    http_port: 8080
    instance_count: 1
    instance_size_slug: <slug z ≥1 GB RAM>
    health_check:
      http_path: /api/v1/health
      initial_delay_seconds: 30
      period_seconds: 10
      timeout_seconds: 5
      failure_threshold: 6
    envs:
      - { key: NODE_ENV, value: production, scope: RUN_TIME }
      - { key: PORT, value: "8080", scope: RUN_TIME }
      - { key: DATABASE_URL, value: "${<db>.DATABASE_URL}", scope: RUN_TIME, type: SECRET }
      - { key: DATABASE_SSL, value: "true", scope: RUN_TIME }
      - { key: DATABASE_CA_CERT, value: "${<db>.CA_CERT}", scope: RUN_TIME }
      # CORS_ORIGINS, CLERK_SECRET_KEY, R2_* – dodaj w panelu (sekrety jako Encrypted)
```

Jeśli wcześniej został dodany job `migrate` (PRE_DEPLOY) – usuń go; nie jest już potrzebny, a uruchamiałby te same migracje drugi raz (patrz sekcja 9).

---

## 5. Kolejność pierwszego deploymentu

1. Utwórz Managed PostgreSQL w FRA1 i dołącz go do `capohub-app` (sekcja 2).
2. Ustaw zmienne środowiskowe (sekcja 3).
3. Skonfiguruj Web Service i health check (sekcja 4).
4. Wypchnij kod na `main` (autodeploy) albo uruchom deploy ręcznie. W logach oczekuj kolejno:
   - build,
   - `[Migrate] Applying 90 pending migration(s): …` → `[Migrate] Applied 90 migration(s)`,
   - `[Bootstrap] Application listening on http://0.0.0.0:8080/api/v1`.
5. Sprawdź `https://<app-url>/api/v1/health` → `200`, `"database":{"status":"up"}`.
6. Zaloguj się z aplikacji mobilnej (ta sama instancja Clerk co `CLERK_SECRET_KEY`).
7. Jednorazowo, ręcznie:
   - nadaj rolę globalną pierwszemu administratorowi (w kodzie nie ma ścieżki nadania `ADMIN`/`SUPER_ADMIN`): `UPDATE users SET global_role = 'SUPER_ADMIN' WHERE <warunek wskazujący jednego użytkownika>;` (dozwolone wartości: `USER`, `EDITOR`, `MODERATOR`, `ADMIN`, `SUPER_ADMIN`);
   - seedy (`seed:music-content`, `seed:songs`) wymagają `ts-node` i pełnego zestawu zmiennych – uruchamiaj lokalnie, ze zmiennymi produkcyjnymi podanymi inline, tylko jeśli są potrzebne.

---

## 6. Weryfikacja migracji

- **Logi startu** (Runtime Logs / logi deploymentu `capohub-server`):
  - `No pending migrations - database is up to date` – nic do zrobienia;
  - `Applying N pending migration(s): …` + `Applied N migration(s)` – sukces;
  - `Startup migrations failed - not starting the HTTP server: …` – kontener kończy się kodem 1, schemat bez zmian.
- **W bazie** (konsola bazy w panelu albo `psql` z Twojego IP dodanego tymczasowo do Trusted Sources):

  ```sh
  psql "host=<host> port=25060 user=doadmin dbname=defaultdb sslmode=verify-full sslrootcert=ca-certificate.crt" \
    -c "select name, executed_at from mikro_orm_migrations order by id desc limit 5;"
  ```

  Ostatnia pozycja powinna odpowiadać najnowszemu plikowi w `src/database/migrations/`.

Typowe błędy przy starcie:

| Komunikat | Przyczyna |
|---|---|
| `DATABASE_CA_CERT is required in production…` | brak `DATABASE_CA_CERT` |
| `DATABASE_CA_CERT must be a PEM-encoded X.509 certificate…` | ucięty lub zniekształcony certyfikat |
| `unable to verify the first certificate` / `self-signed certificate in certificate chain` | certyfikat CA nie pasuje do bazy |
| `no pg_hba.conf entry … no encryption` | `DATABASE_SSL` nie jest `true` |
| `ECONNREFUSED` / timeout | Trusted Sources nie obejmują aplikacji, zły host |
| `Startup migrations failed … Migration X (up) failed: …` | błąd w migracji X – popraw migrację i wdroż ponownie |

### Ręczne uruchomienie migracji (narzędzie administracyjne)

`yarn migration:deploy` (`node dist/database/migrate.js`) aplikuje oczekujące migracje **bez** startu serwera HTTP – np. żeby przygotować bazę przed deploymentem albo zdiagnozować błąd migracji. Nie jest częścią normalnego wdrożenia.
- działa na skompilowanym JS (wymaga `yarn build`), bez `ts-node` i `@mikro-orm/cli`;
- **nie wczytuje `.env`** – zmienne (`NODE_ENV`, `DATABASE_URL`, `DATABASE_SSL`, `DATABASE_CA_CERT`) podaj jawnie w shellu;
- ta sama walidacja i konfiguracja SSL/CA co aplikacja; kod wyjścia 1 przy błędzie.

Nie uruchamiaj go równolegle z deploymentem (sekcja 9).

---

## 7. Logi

- Panel: `capohub-app` → **Runtime Logs** oraz **Deployments** → wybrany deployment → logi build/deploy.
- CLI (opcjonalnie): `doctl apps list`, potem `doctl apps logs <app-id> capohub-server --type run` (oraz `--type build` / `--type deploy`) **[sprawdź flagi w `doctl apps logs --help`]**.
- Aplikacja nie loguje `DATABASE_URL`, haseł ani kluczy (komunikaty błędów migracji są dodatkowo maskowane); w trybie produkcyjnym SQL nie jest logowany (`debug` tylko w `development`).

---

## 8. Rollback

- **Kod:** Deployments → poprzedni udany deployment → **Rollback** **[panel]**. Starsza wersja przy starcie nie znajdzie oczekujących migracji (migracje wykonane, a nieznane starszemu kodowi, są pomijane) i normalnie wystartuje.
- **Rollback kodu NIE cofa migracji bazy.** Poprzednia wersja aplikacji będzie działać na nowszym schemacie.
  - Migracje wyłącznie dodające (nowe tabele, kolumny nullable / z wartością domyślną) – rollback kodu jest bezpieczny.
  - Migracje usuwające lub zmieniające kolumny/tabele – poprzednia wersja może zwracać błędy 500.
- Cofnięcie migracji (`migration:down`) jest ręczne, wymaga `@mikro-orm/cli` (devDependency, czyli lokalnie) i zmiennych produkcyjnych podanych inline. Przed tym: backup / snapshot bazy, sprawdzenie metody `down()` danej migracji. Utracone dane (np. po `DROP COLUMN`) wracają tylko z backupu.

---

## 9. Ograniczenia i ryzyka migracji przy starcie

**Równoległe uruchomienie migracji.** Nie ma blokady między procesami (MikroORM jej nie zakłada). Przy 1 instancji migracje wykonuje tylko nowo startujący kontener – stara wersja już działa i niczego nie migruje. Do równoległego wykonania dojdzie tylko, gdy:
- `instance_count > 1` (każda instancja migruje przy starcie),
- równolegle z deploymentem ktoś uruchomi `yarn migration:deploy` / `migration:up`,
- zostawiony zostanie dodatkowy job PRE_DEPLOY.

Sprawdzone na izolowanej bazie: przy dwóch jednoczesnych startach jedna instancja aplikuje migracje, druga kończy się błędem (`… already exists`) i kodem 1, schemat pozostaje spójny (bez duplikatów w `mikro_orm_migrations`); po restarcie druga instancja nie ma już nic do zrobienia. Przed zwiększeniem liczby instancji warto dodać blokadę (`pg_advisory_lock`) wokół migracji albo wrócić do osobnego joba.

**Migracje usuwające kolumny/tabele.** Podczas deploymentu stara wersja obsługuje ruch, aż nowa przejdzie health check – a nowa wykonała już migracje. Przez ten czas (od kilku sekund do kilku minut) stara wersja działa na nowym schemacie; jeśli migracja usunęła kolumnę/tabelę, której stary kod używa, jego zapytania kończą się błędem 500. Zasada (expand → contract):
1. Deploy N: dodaj nowe kolumny/tabele (nullable lub z default), kod przestaje używać starych.
2. Deploy N+1: dopiero teraz usuń stare kolumny/tabele lub dodaj `NOT NULL`.

Historia projektu zawiera migracje usuwające kolumny i tabele w tym samym wydaniu co zmiana kodu (np. `Migration20261023120000_RemoveSongMediaVote`, `Migration20260928120000_DropSavedLocationRadius`). Przy pierwszym deploymencie to nie ma znaczenia (nie ma starej wersji); w przyszłości takie zmiany warto rozdzielać na dwa deploye.

**Błąd migracji podczas startu.** Transakcja jest wycofywana, kontener kończy się kodem 1 i nie otwiera portu, więc nowa wersja nie przejdzie health checku – deployment zostanie oznaczony jako nieudany, a ruch zostaje na poprzedniej wersji **[zweryfikuj zachowanie w panelu przy pierwszym nieudanym deployu]**. Nowy kontener będzie restartowany i za każdym razem próbował tej samej migracji – naprawa wymaga poprawionego commita (albo rollbacku).

**Ponowne uruchomienie kontenera.** Restart (crash, zmiana zmiennych, redeploy bez zmian) przy braku nowych migracji tylko odczytuje listę wykonanych migracji i startuje normalnie. Jeśli kontener zostanie zabity w trakcie migracji (np. przekroczony czas health checku), PostgreSQL wycofa niezatwierdzoną transakcję i kolejny start wykona migracje od nowa.

**Lokalny development.** `yarn start:dev` / `yarn start` również aplikują oczekujące migracje na bazie z lokalnego `.env` (tak jak w produkcji). Testy unit/e2e i skrypty seedów nie korzystają z `main.ts`, więc ich to nie dotyczy.
