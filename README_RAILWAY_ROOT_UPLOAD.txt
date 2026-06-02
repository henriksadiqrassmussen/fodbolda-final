# Railway root-upload version

Denne ZIP er lavet så filerne ligger DIREKTE i roden:

- package.json
- server.js
- schema.sql
- railway.toml
- .env.example

Vigtigt:
Upload disse filer direkte til GitHub-repoets rod. Railway skal kunne se package.json i første mappe/rod.

Railway Variables:
DATABASE_URL=${{Postgres.DATABASE_URL}}
THESPORTSDB_API_KEY=123
AUTO_UPDATE_ENABLED=true
HISTORY_YEARS=5
CORS_ORIGIN=*
PGSSL=true

Test efter deploy:
/health
