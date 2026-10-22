# secrets/

Runtime secret files for the hosting stack. They are mounted into containers as Docker secrets
(`/run/secrets/<name>`), so they never appear in the compose file, `docker inspect` or `ps`.
Nothing here is committed (see `.gitignore`).

| File | Used by | Contents |
|---|---|---|
| `rpc_url` | alto, policy-service, monitor | Full PEPU RPC URL including the provider key |
| `executor_private_keys` | alto | Comma separated executor private key(s), `0x...` |
| `paymaster_signer_private_key` | policy-service | Fresh dedicated paymaster signer key |
| `privy_app_secret` | policy-service | Privy app secret |
| `admin_token` | policy-service | Random token for `/admin/*` (reachable from the VM only) |

Create them with the commands in `../RUNBOOK.md` ("Keys and secrets"), then:

```sh
sudo chown 1000:1000 secrets/*   # the containers run as uid 1000
chmod 400 secrets/*
```
