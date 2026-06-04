UPLOAD TIL RAILWAY / GITHUB

Upload INDHOLDET af denne mappe til roden af GitHub repoet. Repoet skal se sådan ud:
package.json
server.js
schema.sql
railway.toml
.env.example

Railway:
1. New Project -> Deploy from GitHub repo.
2. Vælg repoet. Vælg IKKE template.
3. Add PostgreSQL i samme Railway project.
4. Backend-service -> Variables:

DATABASE_URL=${{Postgres.DATABASE_URL}}
THESPORTSDB_API_KEY=123
AUTO_UPDATE_ENABLED=true
HISTORY_YEARS=5
CORS_ORIGIN=*
PGSSL=true

Hvis din database-service hedder PostgreSQL i stedet for Postgres, brug:
DATABASE_URL=${{PostgreSQL.DATABASE_URL}}

Sæt IKKE PORT selv. Railway sætter PORT automatisk.

Healthcheck:
Path = /health

Test:
https://DIN-RAILWAY-URL.up.railway.app/health
https://DIN-RAILWAY-URL.up.railway.app/api/debug/routes
https://DIN-RAILWAY-URL.up.railway.app/api/matches/upcoming?leagueId=all&limit=20
