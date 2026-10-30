# CapoHub API – produkcja na DigitalOcean App Platform

Instrukcja do pierwszego (i kolejnych) wdrożeń `capohub-server` na DigitalOcean App Platform.
Zakłada aplikację `capohub-app` w projekcie `capohub`, region **FRA1**, branch `main`, buildpack Node.js (bez Dockera).

Rzeczy, których nie da się ustalić z repozytorium (nazwy zasobów, rozmiary, wartości sekretów), są oznaczone **[panel]**.

---

## 1. Architektura w skrócie

| Komponent | Typ | Build | Run |
|---|---|---|---|
| `capohub-server` | Web Service | `yarn build` | `yarn start:prod` |
| `migrate` | Job, kind **PRE_DEPLOY** | `yarn build` | `yarn migration:deploy` |
| `capohub-db` **[panel]** | Managed PostgreSQL (FRA1) | – | – |

Przebieg każdego deploymentu:

1. Build (`yarn install` + `yarn build`) dla obu komponentów.
2. **Job `migrate`** uruchamia `node dist/database/migrate.js`, który aplikuje oczekujące migracje MikroORM.
   - Brak nowych migracji → kończy się sukcesem.
   - Błąd → kod wyjścia 1 → **deployment zostaje przerwany**, stara wersja działa dalej.
3. Nowa wersja Web Service startuje; ruch przełącza się po pozytywnym health checku.

Migracje **nie** uruchamiają się w `main.ts` ani przy restarcie kontenera – wyłącznie w jobie PRE_DEPLOY.
Seedy **nigdy** nie uruchamiają się automatycznie.

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
- w `NODE_ENV=production` **odmawia startu** (app i job migracji), jeśli: `DATABASE_SSL≠true`, brak/niepoprawny `DATABASE_CA_CERT`, albo `DATABASE_URL` wskazuje na `localhost`/`127.0.0.1`/`::1`.

Parametr `?sslmode=require` w `DATABASE_URL` od DigitalOcean jest **ignorowany** przez MikroORM – o TLS decydują wyłącznie `DATABASE_SSL` i `DATABASE_CA_CERT` (`src/database/mikro-orm-options.factory.ts`).

Ustaw: `DATABASE_CA_CERT=${<db>.CA_CERT}`. Przy ręcznym wklejaniu certyfikatu (np. do lokalnego shella): **Databases → `<db>` → Connection details → Download CA certificate**.

### `DATABASE_URL` publiczny czy prywatny (VPC)?

Zacznij od `${<db>.DATABASE_URL}`. Kod przyjmuje dowolny URL `postgresql://`, więc przejście na adres prywatny (VPC) to wyłącznie zmiana wartości zmiennej. Zanim to zrobisz, sprawdź w panelu:
- czy aplikacja i baza są w tej samej VPC i jaką nazwę ma zmienna z prywatnym URL **[panel]**;
- czy certyfikat serwera obejmuje prywatny hostname – wystarczy wdrożyć i zobaczyć, czy job `migrate` przechodzi (przy niezgodności hosta zakończy się błędem TLS, nie połączy się po cichu bez weryfikacji).

---

## 3. Zmienne środowiskowe

Ustaw je jako **App-Level Environment Variables** (Settings → App-Level Environment Variables) – wtedy widzą je **oba** komponenty (Web Service i job `migrate`) bez duplikowania sekretów.
Zakres (scope): **Run time** – build ich nie potrzebuje (w szczególności nie ustawiaj `NODE_ENV=production` dla build time, żeby instalacja nie pominęła devDependencies potrzebnych do `nest build`).

| Zmienna | Wartość | Encrypt | Kto używa |
|---|---|---|---|
| `NODE_ENV` | `production` | nie | app + migrate |
| `DATABASE_URL` | `${<db>.DATABASE_URL}` | tak | app + migrate |
| `DATABASE_SSL` | `true` | nie | app + migrate |
| `DATABASE_CA_CERT` | `${<db>.CA_CERT}` | nie (certyfikat publiczny) | app + migrate |
| `PORT` | `8080` | nie | app |
| `CORS_ORIGINS` | co najmniej jeden URL, np. `${APP_URL}` dopóki nie ma domeny web **[panel – sprawdź, czy `${APP_URL}` jest rozwijane]** | nie | app |
| `CLERK_SECRET_KEY` | `sk_live_…` (instancja produkcyjna; ta sama co w aplikacji mobilnej) | **tak** | app |
| `R2_ENDPOINT` | `https://<account_id>.r2.cloudflarestorage.com` | nie | app |
| `R2_BUCKET` | nazwa bucketu produkcyjnego | nie | app |
| `R2_PUBLIC_URL` | publiczny URL bucketu | nie | app |
| `R2_ACCESS_KEY_ID` | klucz tokenu R2 | **tak** | app |
| `R2_SECRET_ACCESS_KEY` | sekret tokenu R2 | **tak** | app |

Nie ustawiaj (mają bezpieczne wartości domyślne / są opcjonalne): `API_PREFIX` (`api`), `API_VERSION` (`v1`), `CLERK_PUBLISHABLE_KEY`, `CLERK_JWT_KEY`, `CLERK_AUTHORIZED_PARTIES`, `PUBLIC_WEB_BASE_URL` (dopóki nie ma domeny).

Job `migrate` waliduje **wyłącznie** `NODE_ENV`, `DATABASE_URL`, `DATABASE_SSL`, `DATABASE_CA_CERT` (`src/config/database-env.schema.ts`) – nie potrzebuje Clerk, R2 ani CORS. Zmienne aplikacji widoczne dla joba są przez niego ignorowane.

`CLERK_SECRET_KEY` z prefiksem `sk_test_` przy `NODE_ENV=production` nie blokuje startu, ale w logach pojawi się ostrzeżenie `[Bootstrap] NODE_ENV=production is using a Clerk development instance key`.

---

## 4. Web Service `capohub-server`

| Ustawienie | Wartość |
|---|---|
| Source | GitHub `tomfraczek/capohub-server`, branch `main`, autodeploy wg uznania **[panel]** |
| Build strategy | Buildpack (Node.js) – wersja z `package.json` → `engines.node: 22.x` |
| Build command | `yarn build` |
| Run command | `yarn start:prod` |
| HTTP port | `8080` |
| Instance count | `1` |
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

---

## 5. Pre-Deploy Job `migrate`

Add Component → **Job**, ten sam GitHub repo i branch:

| Ustawienie | Wartość |
|---|---|
| Name | `migrate` |
| Kind / When to run | **Before every deploy** (PRE_DEPLOY) |
| Build command | `yarn build` |
| Run command | `yarn migration:deploy` |
| Instance size | najmniejszy dostępny; jeśli job kończy się OOM – taki jak Web Service **[panel]** |

Zmiennych nie trzeba dodawać na poziomie joba – dziedziczy App-Level Environment Variables.

`yarn migration:deploy` = `node dist/database/migrate.js` (`src/database/migrate.ts`):
- działa na skompilowanym JS – bez `ts-node`, Nest CLI ani `@mikro-orm/cli` (działa po przycięciu devDependencies przez buildpack);
- **nie wczytuje `.env`** – widzi tylko zmienne faktycznie ustawione w procesie;
- używa tej samej walidacji i fabryki opcji MikroORM (SSL/CA) co aplikacja;
- wszystkie oczekujące migracje idą w **jednej transakcji** – błąd dowolnej cofa cały przebieg;
- loguje nazwy migracji, nigdy `DATABASE_URL` ani hasła.

### Fragment App Spec (opcjonalnie, zamiast klikania)

Settings → App Spec → Edit. **Nie wklejaj całości w miejsce istniejącego specu** – dopisz/porównaj sekcje. `<db>` i `instance_size_slug` uzupełnij wartościami z panelu.

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

jobs:
  - name: migrate
    kind: PRE_DEPLOY
    github:
      repo: tomfraczek/capohub-server
      branch: main
      deploy_on_push: true
    environment_slug: node-js
    build_command: yarn build
    run_command: yarn migration:deploy
    instance_count: 1
    instance_size_slug: <slug>

envs:
  - { key: NODE_ENV, value: production, scope: RUN_TIME }
  - { key: DATABASE_URL, value: "${<db>.DATABASE_URL}", scope: RUN_TIME, type: SECRET }
  - { key: DATABASE_SSL, value: "true", scope: RUN_TIME }
  - { key: DATABASE_CA_CERT, value: "${<db>.CA_CERT}", scope: RUN_TIME }
  # PORT, CORS_ORIGINS, CLERK_SECRET_KEY, R2_* – dodaj w panelu (sekrety jako Encrypted)
```

---

## 6. Kolejność pierwszego deploymentu

1. Wypchnij kod z tymi zmianami na `main` (na czas konfiguracji możesz wyłączyć autodeploy).
2. Utwórz Managed PostgreSQL w FRA1 i dołącz go do `capohub-app` (sekcja 2).
3. Ustaw App-Level Environment Variables (sekcja 3).
4. Skonfiguruj Web Service (sekcja 4) i dodaj job `migrate` (sekcja 5).
5. Uruchom deploy. W logach deploymentu oczekuj kolejno:
   - build obu komponentów,
   - job `migrate`: `Applying 90 pending migration(s): …` → `Applied 90 migration(s)` (pierwszy raz),
   - Web Service: `Application listening on http://0.0.0.0:8080/api/v1`.
6. Sprawdź `https://<app-url>/api/v1/health` → `200`, `"database":{"status":"up"}`.
7. Zaloguj się z aplikacji mobilnej (ta sama instancja Clerk co `CLERK_SECRET_KEY`).
8. Jednorazowo, ręcznie:
   - nadaj rolę globalną pierwszemu administratorowi (w kodzie nie ma ścieżki nadania `ADMIN`/`SUPER_ADMIN`): `UPDATE users SET global_role = 'SUPER_ADMIN' WHERE <warunek wskazujący jednego użytkownika>;` (dozwolone wartości: `USER`, `EDITOR`, `MODERATOR`, `ADMIN`, `SUPER_ADMIN`);
   - seedy (`seed:music-content`, `seed:songs`) wymagają `ts-node` i pełnego zestawu zmiennych – uruchamiaj lokalnie, ze zmiennymi produkcyjnymi podanymi inline, tylko jeśli są potrzebne.

---

## 7. Weryfikacja migracji

- **Logi joba** (Deployments → konkretny deployment → `migrate`):
  - `No pending migrations - database is up to date` – nic do zrobienia;
  - `Applying N pending migration(s): …` + `Applied N migration(s)` – sukces;
  - `ERROR [Migrate] Migration run failed…` – deployment przerwany, schemat bez zmian (jedna transakcja).
- **W bazie** (konsola bazy w panelu albo `psql` z Twojego IP dodanego tymczasowo do Trusted Sources):

  ```sh
  psql "host=<host> port=25060 user=doadmin dbname=defaultdb sslmode=verify-full sslrootcert=ca-certificate.crt" \
    -c "select name, executed_at from mikro_orm_migrations order by id desc limit 5;"
  ```

  Ostatnia pozycja powinna odpowiadać najnowszemu plikowi w `src/database/migrations/`.

Typowe błędy joba:

| Komunikat | Przyczyna |
|---|---|
| `DATABASE_CA_CERT is required in production…` | brak `DATABASE_CA_CERT` / zmienna nie jest app-level |
| `DATABASE_CA_CERT must be a PEM-encoded X.509 certificate…` | ucięty lub zniekształcony certyfikat |
| `(UNABLE_TO_VERIFY_LEAF_SIGNATURE)` / `self-signed certificate in certificate chain` | certyfikat CA nie pasuje do bazy |
| `(28000) no pg_hba.conf entry … no encryption` | `DATABASE_SSL` nie jest `true` |
| `ECONNREFUSED` / timeout | Trusted Sources nie obejmują aplikacji, zły host |

---

## 8. Logi

- Panel: `capohub-app` → **Runtime Logs** (Web Service) oraz **Deployments** → wybrany deployment → logi build/deploy (w tym job `migrate`).
- CLI (opcjonalnie): `doctl apps list`, potem `doctl apps logs <app-id> capohub-server --type run` (oraz `--type build` / `--type deploy`; dla joba podaj komponent `migrate`) **[sprawdź flagi w `doctl apps logs --help`]**.
- Aplikacja nie loguje `DATABASE_URL`, haseł ani kluczy; w trybie produkcyjnym SQL nie jest logowany (`debug` tylko w `development`).

---

## 9. Rollback

- **Kod:** Deployments → poprzedni udany deployment → **Rollback** **[panel]**.
- **Rollback kodu NIE cofa migracji bazy.** Poprzednia wersja aplikacji będzie działać na nowszym schemacie.
  - Migracje wyłącznie dodające (nowe tabele, kolumny nullable / z wartością domyślną) – rollback kodu jest bezpieczny.
  - Migracje usuwające lub zmieniające kolumny/tabele – poprzednia wersja może zwracać błędy 500.
- Cofnięcie migracji (`migration:down`) jest ręczne, wymaga `@mikro-orm/cli` (devDependency, czyli lokalnie) i zmiennych produkcyjnych podanych inline. Przed tym: backup / snapshot bazy, sprawdzenie metody `down()` danej migracji. Utracone dane (np. po `DROP COLUMN`) wracają tylko z backupu.

### Zgodność migracji z wdrożeniem bez przestojów

Job PRE_DEPLOY wykonuje migracje, **zanim** nowa wersja zastąpi starą – przez kilka minut stara wersja działa już na nowym schemacie. Dotyczy to każdej aktualizacji (nie pierwszego deploymentu).

Zasada na przyszłość (expand → contract):
1. Deploy N: dodaj nowe kolumny/tabele (nullable lub z default), kod pisze/czyta nowe pola, nie używa starych.
2. Deploy N+1: dopiero teraz usuń stare kolumny/tabele lub dodaj `NOT NULL`.

Historia projektu zawiera migracje usuwające kolumny i tabele w tym samym wydaniu co zmiana kodu (np. `Migration20261023120000_RemoveSongMediaVote`, `Migration20260928120000_DropSavedLocationRadius`). Takie zmiany w przyszłości warto rozdzielać na dwa deploye.
