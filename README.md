# Peak Utilization

A Subway Builder mod for analyzing route capacity utilization and adjusting train schedules based on passenger demand.

**Author:** [HaguBian](https://github.com/HaguBian)

## Features

- **Route dashboard:** View each route's peak utilization, peak demand period, bottleneck segment, train frequency, and cars per train.
- **Route details:** Select a route name to open Route Info and adjust its configuration.
- **Train composition:** Add or remove cars per train using increments defined by the train type. Controls are disabled when the next adjustment would exceed the allowed minimum or maximum.
- **Demand-based scheduling:** Add or remove trains for High, Medium, Low, and Very Low demand levels. Train counts can be reduced to zero but cannot become negative.
- **Automatic data loading:** Load route data when the mod initializes and when a game is loaded. Use **Refresh** to update the dashboard immediately.
- **Automatic refresh:** Refresh route data at most once every 10 in-game minutes while the game is running.
- **Sortable columns:** Select dashboard column headers to sort the data. Names consisting only of numbers appear before names containing letters. Natural sorting places `2` before `10` and `Line 2` before `Line 10`.

## Dashboard Reference

| Column | Description |
| --- | --- |
| Route | Route name. Select it to open Route Info. |
| Peak | Utilization percentage at the most congested segment during the analyzed peak period. |
| Period | Demand level corresponding to the peak period. |
| Segment | The segment between two stations with the highest utilization during that period. |
| Freq. | Train frequency during the peak period, measured in trains per hour. |
| Cars | Number of cars per train. |

**Peak utilization colors**

- Green: below 70%
- Yellow: 70% to below 80%
- Orange: 80% to below 90%
- Red: 90% to 100%
- Purple: above 100%

**Demand level colors**

- High: red
- Medium: orange
- Low: yellow
- Very Low: green

## Screenshots

### Dashboard

![Peak Utilization dashboard](./doc/image/peak-utilization-dashboard.png)

### Route Info

![Route information and demand controls](./doc/image/route-info.png)

## Installation

### Install from GitHub Releases

1. Open [Peak Utilization Releases](https://github.com/HaguBian/subwaybuilder-peak-utilization/releases/latest).
2. Download `subwaybuilder-peak-utilization-v1.0.2.zip`.
3. Extract `index.js` and `manifest.json` directly into the mod folder for your operating system:

   - **Windows:** `%APPDATA%\metro-maker4\mods\subwaybuilder-peak-utilization\`
   - **macOS:** `~/Library/Application Support/metro-maker4/mods/subwaybuilder-peak-utilization/`
   - **Linux:** `~/.config/metro-maker4/mods/subwaybuilder-peak-utilization/`

   Create the folder if it does not exist. Make sure both files are directly inside the mod folder, not inside an additional nested directory.
4. Launch Subway Builder and enable **Peak Utilization** under **Settings > Mods**.

### Build from Source

For development, install [Node.js](https://nodejs.org/) and [pnpm](https://pnpm.io/), then run:

```bash
pnpm install
pnpm build
```

The build output is written to `dist/`. Use `pnpm dev:link` to link the built mod into the game's mods folder.

## Development

| Command | Description |
| --- | --- |
| `pnpm install` | Install project dependencies. |
| `pnpm build` | Build the mod into `dist/`. |
| `pnpm typecheck` | Run the TypeScript type checker. |
| `pnpm dev:link` | Link `dist/` to the game's mods folder. |
| `pnpm dev:unlink` | Remove the link created by `dev:link`. |
| `pnpm dev` | Run the build watcher and launch the game. Logs are saved to `debug/latest.log`. |

## Notes

- Requires Subway Builder Modding API v1.0.0. Other API versions may not be compatible.
- The mod is marked as compatible with game versions up to 1.7.2.
- Utilization calculations use completed commute data, train schedule settings, and train type capacity. Routes with insufficient data may display `N/A`.
- Changes to cars per train and demand schedules are written directly to the route configuration in the game.
