FOOTBALL RESULT REGISTER - IDIOTSIKKER RAILWAY BACKEND v1.2.2

Denne version kan starte og svare på fodbold.eu, selv hvis PostgreSQL ikke er koblet korrekt endnu.
Hvis database ikke virker, svarer API'et med tomme fallback-data i stedet for at give Failed to fetch.

UPLOAD TIL GITHUB
1. Upload ALLE filer fra denne mappe direkte i roden af GitHub repoet fodbolda-final.
2. Der må ikke ligge en ekstra mappe rundt om filerne.

RAILWAY VARIABLES PÅ BACKEND-SERVICE fodbolda-final
Sæt disse:

AUTO_UPDATE_ENABLED=true
CORS_ORIGIN=*
DATABASE_URL=${{Postgres.DATABASE_URL}}
HISTORY_YEARS=5
PGSSL=false
THESPORTSDB_API_KEY=123

Hvis database-boksen hedder PostgreSQL, brug:
DATABASE_URL=${{PostgreSQL.DATABASE_URL}}

VIGTIGT:
- Slet PORT hvis den findes.
- Slet PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE hvis de findes på backend-service.
- Brug ikke DATABASE_PUBLIC_URL på backend.

TEST EFTER REDEPLOY
https://DIN-RAILWAY-URL/health
https://DIN-RAILWAY-URL/api/debug/db
https://DIN-RAILWAY-URL/api/matches/upcoming?leagueId=all&limit=20

MÅL:
/health må gerne vise dbReady=false i starten, men siden skal stadig virke uden Failed to fetch.
Når DATABASE_URL er korrekt, vil /health vise dbReady=true.
