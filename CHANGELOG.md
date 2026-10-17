# Changelog

## 0.0.4

- Update the pinned dsh development packages to 0.2.1-rc.2.
- Reword the note shown when Settings cannot save the address, since newer dsh releases let any signed-in page save it.
- Follow the dsh light and dark theme through the page's color scheme.
- Give the card its own sidebar footer row without relying on dsh's page markup.

## 0.0.3

- Update the pinned dsh development packages to 0.2.1-alpha.2.

## 0.0.2

- Add `npm run check` for formatting, lint and language checks.
- Run checks and tests in CI with one summary check.
- Show only the engine figures Spark Scope reports, with its labels for session averages, two-second rates, context use, mean decode time and cache hit since start.
- Say when Spark Scope needs an API key to read oMLX.
- List each model server with its decode rate and state when there are several.
- Show GPU memory (VRAM on discrete GPUs), leave out temperature and power on Mac nodes, and put more than four nodes in two columns.

## 0.0.1

- Spark Scope Glance card at the foot of the sidebar, with a button that folds it into one line.
- Spark Scope tab in Settings for the dashboard address.
