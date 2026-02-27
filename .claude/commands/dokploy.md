# Dokploy Connection — Youssef's Server

You are connected to the Dokploy deployment platform for **Youssef's server**.

## Connection Details

- **Base URL:** `http://46.224.34.69`
- **API Base URL:** `http://46.224.34.69:3000/api`
- **API Key:** `codex-skillTkzxPxFDmKYWrMGOBPLHkPcwEMmcxnShMuAIOkDsHhUikRylMmQWlKJJPeuycLjq`
- **Auth Header:** `x-api-key`

## How to Make API Calls

Dokploy uses a tRPC-based REST API. Use `curl` via the Bash tool:

```bash
curl -s "http://46.224.34.69:3000/api/{resource}.{action}" \
  -H "x-api-key: codex-skillTkzxPxFDmKYWrMGOBPLHkPcwEMmcxnShMuAIOkDsHhUikRylMmQWlKJJPeuycLjq" \
  -H "Content-Type: application/json"
```

For POST/mutations, pass a JSON body:
```bash
curl -s -X POST "http://46.224.34.69:3000/api/{resource}.{action}" \
  -H "x-api-key: codex-skillTkzxPxFDmKYWrMGOBPLHkPcwEMmcxnShMuAIOkDsHhUikRylMmQWlKJJPeuycLjq" \
  -H "Content-Type: application/json" \
  -d '{"param": "value"}'
```

## Common Endpoints

### Projects
- `GET  project.all` — list all projects
- `GET  project.one?input={"projectId":"..."}` — get a single project
- `POST project.create` — create a project `{"name":"...","description":"..."}`
- `POST project.remove` — delete a project `{"projectId":"..."}`

### Applications
- `GET  application.all?input={"projectId":"..."}` — list apps in a project
- `GET  application.one?input={"applicationId":"..."}` — get a single app
- `POST application.deploy` — deploy an app `{"applicationId":"..."}`
- `POST application.stop` — stop an app `{"applicationId":"..."}`
- `POST application.start` — start an app `{"applicationId":"..."}`
- `POST application.reload` — reload an app `{"applicationId":"..."}`
- `GET  application.readTraefikConfig?input={"applicationId":"..."}` — get traefik config
- `GET  application.getDeployments?input={"applicationId":"..."}` — deployment history

### Docker Compose
- `GET  compose.all?input={"projectId":"..."}` — list compose services
- `GET  compose.one?input={"composeId":"..."}` — get a compose service
- `POST compose.deploy` — deploy compose `{"composeId":"..."}`
- `POST compose.stop` — stop compose `{"composeId":"..."}`
- `POST compose.start` — start compose `{"composeId":"..."}`
- `POST compose.update` — update compose config
- `GET  compose.deployments?input={"composeId":"..."}` — deployment history

### Databases
- `GET  postgres.all?input={"projectId":"..."}` — list postgres DBs
- `GET  mariadb.all?input={"projectId":"..."}` — list MariaDB DBs
- `GET  redis.all?input={"projectId":"..."}` — list Redis instances
- `POST postgres.deploy` — deploy a postgres DB `{"postgresId":"..."}`
- `POST postgres.stop` — stop postgres `{"postgresId":"..."}`

### Deployments & Logs
- `GET  deployment.all?input={"applicationId":"..."}` — list deployments
- `GET  deployment.allByCompose?input={"composeId":"..."}` — compose deployments

### Server
- `GET  server.withStats` — server stats (CPU, memory, disk)
- `GET  docker.getConfig` — Docker configuration

## Known Projects on This Server

Retrieved from the API — includes:
- **Nori Lebanon** (`projectId: Ndgu8RLrqNhqQrnH0uFeO`) — Docker Compose app on GitHub (`youssefhage/nori-lebanon`, branch: main)

Run `project.all` to get the full current list.

## Instructions

When the user invokes `/dokploy`, respond to their request by:

1. Determine what deployment action or query they need
2. Make the appropriate API call(s) using curl, piping through `python3 -m json.tool` for readability
3. Present results clearly — summarize key fields rather than dumping raw JSON when possible
4. If the user provides arguments (e.g., `/dokploy show all projects`), act on those immediately

If no specific request is given, ask the user what they'd like to do (e.g., check deployments, redeploy a service, view logs, check server stats).

$ARGUMENTS
