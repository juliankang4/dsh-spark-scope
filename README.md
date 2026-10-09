# dsh-spark-scope

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that puts the Glance view of the [Spark Scope](https://github.com/juliankang4/spark-scope) mini window in the left sidebar, so you can keep an eye on your DGX Spark nodes and their model server while you work. It works in both the browser (`dsh web`) and the Desktop app.

<p align="center"><img src="https://raw.githubusercontent.com/juliankang4/dsh-spark-scope/main/docs/card.png" alt="The card in light and dark themes, and collapsed to a single line" width="760"></p>

## Install

```sh
dsh plugin --profile web add dsh-spark-scope
```

In the Desktop app, open Plugins, choose Add plugin, enter `dsh-spark-scope` and install it.

You also need a running Spark Scope server. See its [installation guide](https://github.com/juliankang4/spark-scope#installation).

## Set up

Open the Spark Scope tab in Settings, type your Spark Scope dashboard's address and press Enter. Both a local network address like `http://spark-scope.local:8787` and a tailnet address like `https://spark-scope.example.ts.net` work. If you leave out the scheme, `http://` is added for you. Clear the field to hide the card. The address can only be changed on the computer that runs dsh; a page opened from another computer shows the field but cannot save it.

The data is fetched by dsh, not by your browser, so the address has to work from the computer that runs dsh. Spark Scope only answers requests made to localhost, an IP address or its own host name. To use any other name, such as a reverse proxy's, add it to `SPARK_SCOPE_ALLOWED_HOSTS` on the Spark Scope server.

## The card

The card sits at the bottom of the sidebar, above other footer items such as the dsh-cost-meter balance. The top of the card shows the model name, how many nodes are responding, and the decode and prefill rates with five-minute sparklines. Below that are running and queued requests, KV cache usage, TTFT and TPOT p95 for the last five minutes and the prefix cache hit rate, followed by a row for each node with its GPU temperature, power draw, load and GPU memory use. With more than four nodes, the rows fill two columns.

The card shows only the figures your inference engine reports, under the same labels Spark Scope uses. oMLX reports mean decode and prefill rates since the server started, so the card shows those without sparklines. llama.cpp reports mean decode time in place of TPOT and context use in place of KV cache. When Spark Scope needs an API key to read oMLX, the card says so.

If you run more than one model server, the card adds up their rates and requests, like Spark Scope's "All at once" view, and lists each server with its decode rate and state. A note such as "(servers 1/2)" means only some of the servers report that rate.

Memory on a discrete GPU is labeled VRAM. Mac nodes have no GPU temperature or power reading, so their rows leave them out, and the GPU power total says how many nodes it covers, for example "(5/6 nodes)".

The dot next to the model name is green when Spark Scope reports the cluster as healthy and orange for any other status. It turns red if Spark Scope stops responding or its data is more than 20 seconds old. A dash (`—`) means Spark Scope has no reading for that value.

The button in the top right corner collapses the card to a single line with the model name and decode rate, and your browser remembers the setting. The card is hidden while the sidebar is collapsed. It uses the dsh theme and language (English, Chinese, and Korean with [dsh-locale-ko](https://github.com/juliankang4/dsh-locale-ko)) and scales with [dsh-ui-scale](https://github.com/juliankang4/dsh-ui-scale).

## How it reads Spark Scope

The plugin adds a `/plugins/dsh-spark-scope/state` route to the dsh web server. While the page is visible, the card requests it every 2 seconds, and dsh fetches `<address>/api/state` with a 5-second timeout. The plugin only reads data and never changes anything on Spark Scope or the nodes. The route uses the same sign-in and Host checks as dsh's own API, so only a signed-in dsh page can read it. dsh ignores any Spark Scope response larger than 2 MB. See dsh's [SAFETY.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/SAFETY.md) for running dsh safely.

## Configuration

| Field | Default | Description |
| --- | --- | --- |
| `url` | empty | Spark Scope address (`http` or `https`). Leave it empty to hide the card. |

The Spark Scope tab in Settings saves this value. You can also set it in the profile's `cordis.patch.yml`:

```yaml
- id: spark-scope
  name: dsh-spark-scope
  config:
    url: http://spark-scope.local:8787
```

## Development

Use Node.js 24. Install dependencies with `npm ci`. Run `npm run check` for formatting, lint, JavaScript syntax and strict TypeScript checks. Run `npm test` to build and test the shipped bundle.

Type suppressions must use `@ts-expect-error: <reason>`. Inline lint suppressions must name one rule: `biome-ignore lint/<group>/<rule>: <reason>`. Blanket and file-wide lint suppressions are rejected. Non-null assertions remain allowed where TypeScript cannot follow an existing guard. The npm-generated lockfile is not reformatted.

Pull requests and pushes to `main` run the same check and test commands. The `CI passed` summary succeeds only when both jobs succeed; failed, cancelled and skipped jobs fail the summary.

Tested with dsh 0.2.0-rc.2 in Chrome and in the macOS Desktop app, using sample data in the state format of Spark Scope 0.1.4 and of the older 0.1.3.
