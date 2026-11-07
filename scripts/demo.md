# Demo

Local catalog, sample tenant, and token issuer. The root `docker-compose.yml`
is the stack. Ports 5432, 3000, 3001, and 8080 need to be free. Keep
`POSTGRES_PASSWORD` and `BASE_IMAGE` set for every `docker compose` command
in the same shell.

```powershell
$env:POSTGRES_PASSWORD = "catalog-demo"
$env:BASE_IMAGE = "node:22.21.0-bookworm-slim"
docker compose up --build -d
```

Wait until the catalog answers, then seed the platform owner:

```powershell
curl.exe -fsS http://127.0.0.1:3000/api/health
docker compose run --rm -e CATALOG_BOOTSTRAP_APPROVER_OID=00000000-0000-4000-8000-0000000000a1 migrate node scripts/bootstrap-approver.mjs
```

Request an approval as one user, and approve it as the platform owner.
JSON is written to files so PowerShell does not rewrite the quotes:

```powershell
$requester = (curl.exe -fsS "http://127.0.0.1:8080/user-token?oid=00000000-0000-4000-8000-0000000000b2").Trim()
$approver = (curl.exe -fsS "http://127.0.0.1:8080/user-token?oid=00000000-0000-4000-8000-0000000000a1").Trim()
Set-Content -Path $env:TEMP\approval.json -Encoding ascii -NoNewline -Value '{"app_name":"sample","bitbucket_repo":"launchpad/sample","environment":"dev","pipeline_client_id":"00000000-0000-4000-8000-0000000000c1","federated_subject":"repository:launchpad/sample:environment:sample","ci_provider":"bitbucket","repo_id":"{11111111-1111-4111-8111-111111111111}"}'
$pending = curl.exe -fsS -H "authorization: Bearer $requester" -H "content-type: application/json" --data-binary "@$env:TEMP\approval.json" http://127.0.0.1:3000/api/approvals | ConvertFrom-Json
$id = $pending.data[0].id
Set-Content -Path $env:TEMP\decision.json -Encoding ascii -NoNewline -Value '{"decision":"approved"}'
curl.exe -fsS -H "authorization: Bearer $approver" -H "content-type: application/json" --data-binary "@$env:TEMP\decision.json" "http://127.0.0.1:3000/api/approvals/$id/decision"
```

Register the app with the same call the pipeline makes (`POST /api/apps`):

```powershell
$pipeline = (curl.exe -fsS "http://127.0.0.1:8080/pipeline-token?repo=%7B11111111-1111-4111-8111-111111111111%7D").Trim()
Set-Content -Path $env:TEMP\register.json -Encoding ascii -NoNewline -Value '{"name":"sample","owner_object_id":"00000000-0000-4000-8000-0000000000b2","description":"Sample app that calls the model gateway.","url":"https://sample.localhost","revision":"demo"}'
curl.exe -fsS -H "authorization: Bearer $pipeline" -H "content-type: application/json" --data-binary "@$env:TEMP\register.json" http://127.0.0.1:3000/api/apps
```

Open http://127.0.0.1:3000/, paste `$approver` into Dev token, choose Use token,
and search. The list call behind that screen is:

```powershell
curl.exe -fsS http://127.0.0.1:3000/
curl.exe -fsS -H "authorization: Bearer $approver" "http://127.0.0.1:3000/api/apps?q=sample"
```

Open http://127.0.0.1:3001/. Call `/api/sample`. No Portkey key is configured,
so this is 503:

```powershell
curl.exe -fsS http://127.0.0.1:3001/
Set-Content -Path $env:TEMP\sample.json -Encoding ascii -NoNewline -Value '{}'
curl.exe -sS -D - -o - -H "authorization: Bearer $approver" -H "content-type: application/json" --data-binary "@$env:TEMP\sample.json" http://127.0.0.1:3001/api/sample
```
