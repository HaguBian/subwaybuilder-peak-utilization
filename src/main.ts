import { calculateAllRoutes } from './utilization';
import type { Route, RouteUtilization, Station, Train, TrainSchedule } from './types';

const MOD = '[Peak Utilization]';
const SAMPLE_INTERVAL_SECONDS = 600;
const api = (window as any).SubwayBuilderAPI;
type DemandScheduleKey = 'highDemand' | 'mediumDemand' | 'lowDemand' | 'veryLowDemand';
const demandScheduleLevels: { key: DemandScheduleKey; id: string; label: string; color: string }[] = [
  { key: 'highDemand', id: 'high', label: 'High demand', color: '#ef4444' },
  { key: 'mediumDemand', id: 'medium', label: 'Medium demand', color: '#f97316' },
  { key: 'lowDemand', id: 'low', label: 'Low demand', color: '#eab308' },
  { key: 'veryLowDemand', id: 'very-low', label: 'Very low demand', color: '#22c55e' },
];
const routeNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

if (!api) {
  console.error(`${MOD} SubwayBuilderAPI was not available when the mod loaded.`);
} else {
  let lastSampleTime: number | null = null;
  let lastSnapshot: RouteUtilization[] = [];
  let lastError = '';
  let refreshPanel: (() => void) | null = null;
  let stationNames = new Map<string, string>();
  let lastRoutes: Route[] = [];
  let lastTrains: Train[] = [];
  type SortColumn = 'route' | 'peak' | 'period' | 'frequency' | 'cars';

  function refreshData(): void {
    const stations = (api.gameState.getStations() ?? []) as Station[];
    stationNames = new Map(stations.map((station) => [station.id, station.name || station.id]));
    lastRoutes = (api.gameState.getRoutes() ?? []) as Route[];
    lastTrains = (api.gameState.getTrains() ?? []) as Train[];
    lastSnapshot = calculateAllRoutes(api);
    lastError = '';
  }

  function sampleIfDue(forceFirst = false): void {
    const elapsed = Number(api.gameState.getElapsedSeconds?.() ?? 0);
    if (!Number.isFinite(elapsed)) return;
    if (api.gameState.isPaused?.() && !forceFirst) return;
    if (lastSampleTime !== null && elapsed - lastSampleTime < SAMPLE_INTERVAL_SECONDS && !forceFirst) return;

    try {
      refreshData();
      lastSampleTime = elapsed;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error(`${MOD} Failed to calculate utilization`, error);
    }
    refreshPanel?.();
  }

  function formatPercent(value: number | null): string {
    return value === null || !Number.isFinite(value) ? 'N/A' : `${value.toFixed(1)}%`;
  }

  function segmentDisplayName(result: RouteUtilization): string {
    const segment = result.peakPeriodBottleneck;
    if (!segment) return 'N/A';
    const fromStation = stationNames.get(segment.fromStationId ?? '') ?? segment.fromStationId ?? '?';
    const toStation = stationNames.get(segment.toStationId ?? '') ?? segment.toStationId ?? '?';
    return `${fromStation} → ${toStation}`;
  }

  function utilizationColor(value: number | null): string | undefined {
    if (value === null || !Number.isFinite(value)) return undefined;
    if (value > 100) return '#a855f7';
    if (value >= 90) return '#ef4444';
    if (value >= 80) return '#f97316';
    if (value >= 70) return '#eab308';
    return '#22c55e';
  }

  function demandColor(value: string | null): string | undefined {
    return demandScheduleLevels.find((level) => level.id === value)?.color;
  }

  function numericRouteName(value: string): number | null {
    if (value.trim() === '') return null;
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  function compareRouteNames(a: string, b: string): number {
    const numericA = numericRouteName(a);
    const numericB = numericRouteName(b);
    if (numericA !== null && numericB !== null) return numericA - numericB;
    return routeNameCollator.compare(a, b);
  }

  function limitWarningColor(value: number, limit: number): string | undefined {
    return limit > 0 && value > limit * 0.9 ? '#ef4444' : undefined;
  }

  function closeDashboardOnEscape(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    const target = event.target;
    if (target instanceof HTMLElement &&
      (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))) return;

    const title = Array.from(document.querySelectorAll<HTMLElement>('h1, h2, h3, [role="heading"]'))
      .find((element) => element.textContent?.trim() === 'Peak Utilization');
    if (!title) return;

    let container: HTMLElement | null = title;
    for (let depth = 0; container && depth < 6; depth++, container = container.parentElement) {
      const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
      const closeButton = buttons.find((button) => {
        const label = `${button.getAttribute('aria-label') ?? ''} ${button.title}`.toLowerCase();
        return /\b(close|dismiss)\b/.test(label);
      }) ?? buttons.find((button) => {
        const label = button.textContent?.trim();
        return label === '×' || label === '✕' || label === '✖';
      });
      if (!closeButton) continue;

      event.preventDefault();
      event.stopPropagation();
      closeButton.click();
      return;
    }
  }

  function renderPanel(): any {
    const React = api.utils?.React;
    if (!React) return 'React UI is unavailable in this game build.';
    const [sortColumnValue, setSortColumn] = React.useState(null);
    const sortColumn = sortColumnValue as SortColumn | null;
    const [sortAscending, setSortAscending] = React.useState(true);
    const [selectedRouteIdValue, setSelectedRouteId] = React.useState(null);
    const selectedRouteId = selectedRouteIdValue as string | null;
    const [routeActionError, setRouteActionError] = React.useState('');
    const [, setRenderVersion] = React.useState(0);
    refreshPanel = () => setRenderVersion((version: number) => version + 1);
    const h = React.createElement;
    const sortBy = (column: SortColumn): void => {
      if (sortColumn === column) {
        setSortAscending(!sortAscending);
      } else {
        setSortColumn(column);
        setSortAscending(true);
      }
    };
    const sortedSnapshot = [...lastSnapshot];
    const activeSortColumn = sortColumn;
    if (activeSortColumn) {
      sortedSnapshot.sort((a, b) => {
        const aValue = {
          route: a.routeName,
          peak: a.peakPeriodUtilizationPercent,
          period: a.peakPeriodDemand,
          frequency: a.peakPeriodTrainsPerHour,
          cars: a.carsPerTrain,
        }[activeSortColumn];
        const bValue = {
          route: b.routeName,
          peak: b.peakPeriodUtilizationPercent,
          period: b.peakPeriodDemand,
          frequency: b.peakPeriodTrainsPerHour,
          cars: b.carsPerTrain,
        }[activeSortColumn];
        if (aValue === null || bValue === null) {
          if (aValue === bValue) return 0;
          return aValue === null ? 1 : -1;
        }
        if (activeSortColumn === 'route') {
          const numericA = numericRouteName(a.routeName);
          const numericB = numericRouteName(b.routeName);
          if ((numericA === null) !== (numericB === null)) return numericA === null ? 1 : -1;
          const comparison = compareRouteNames(a.routeName, b.routeName) || a.routeId.localeCompare(b.routeId);
          return sortAscending ? comparison : -comparison;
        }
        const comparison = typeof aValue === 'string' && typeof bValue === 'string'
          ? aValue.localeCompare(bValue)
          : Number(aValue) - Number(bValue);
        return sortAscending ? comparison : -comparison;
      });
    }
    const rows = sortedSnapshot.map((result) => {
      const segmentLabel = segmentDisplayName(result);
      return h('tr', { key: result.routeId, style: { borderBottom: '1px solid var(--border, #444)' } }, [
        h('td', { key: 'route', style: clippedCellStyle, title: result.routeName }, h('button', {
          type: 'button',
          onClick: () => setSelectedRouteId(result.routeId),
          style: { ...routeLinkStyle, color: result.routeColor || 'inherit' },
        }, result.routeName)),
        h('td', { key: 'peak', style: { ...cellStyle, textAlign: 'center', color: utilizationColor(result.peakPeriodUtilizationPercent) } }, formatPercent(result.peakPeriodUtilizationPercent)),
        h('td', { key: 'period', style: { ...cellStyle, textAlign: 'center' } }, result.peakPeriodDemand ?? 'N/A'),
        h('td', { key: 'segment', style: clippedCellStyle }, segmentLabel),
        h('td', { key: 'trains', style: { ...compactCellStyle, color: limitWarningColor(result.peakPeriodTrainsPerHour, result.peakPeriodTrainLimit) } }, `${result.peakPeriodTrainsPerHour.toFixed(2)}`),
        h('td', { key: 'cars', style: { ...compactCellStyle, color: limitWarningColor(result.carsPerTrain, result.carsLimit) } }, String(result.carsPerTrain)),
      ]);
    });
    const sortableHeaderStyle = { ...headerStyle, cursor: 'pointer' };
    const sortLabel = (column: SortColumn, label: string): string => (
      sortColumn === column ? `${label} ${sortAscending ? '▲' : '▼'}` : label
    );
    const columnWidths = [60, 70, 60, 180, 60, 40];
    const tableStyle = { width: '100%', tableLayout: 'fixed' as const, borderCollapse: 'collapse' as const };
    const selectedRoute = selectedRouteId ? lastRoutes.find((route) => route.id === selectedRouteId) : null;
    const selectedResult = selectedRouteId ? lastSnapshot.find((result) => result.routeId === selectedRouteId) : null;
    const routeTrains = selectedRoute ? lastTrains.filter((train) => train.routeId === selectedRoute.id) : [];
    const routeTrainType = selectedRoute?.trainType ? api.trains?.getTrainType?.(selectedRoute.trainType) : undefined;
    const carStats = routeTrainType?.stats;
    const currentRouteCars = selectedRoute
      ? selectedRoute.carsPerTrain ?? routeTrains[0]?.cars ?? selectedResult?.carsPerTrain ?? 0
      : 0;
    const demandScheduleCount = (schedule: TrainSchedule | undefined, key: DemandScheduleKey): number => {
      if (!schedule) return 0;
      const value = key === 'veryLowDemand'
        ? schedule.veryLowDemand ?? schedule.veryLow
        : schedule[key];
      return typeof value === 'number' && Number.isFinite(value) ? value : 0;
    };
    const minRouteCars = Number.isFinite(carStats?.minCars) ? carStats.minCars : 1;
    const maxRouteCars = Number.isFinite(carStats?.maxCars) ? carStats.maxCars : currentRouteCars;
    const carStep = Number.isFinite(carStats?.carsPerCarSet) && carStats.carsPerCarSet > 0 ? carStats.carsPerCarSet : 1;
    const updateRoute = (action: 'add-car-set' | 'remove-car-set'): void => {
      if (!selectedRoute) return;
      try {
        setRouteActionError('');
        if (!selectedRoute.trainType || !carStats) throw new Error('The game could not read this route’s train configuration.');
        const currentCars = Number(currentRouteCars);
        if (!Number.isFinite(currentCars) || currentCars <= 0) throw new Error('The route’s current car count is unavailable.');
        const nextCars = action === 'add-car-set' ? currentCars + carStep : currentCars - carStep;
        if (action === 'add-car-set' && nextCars > maxRouteCars) {
          throw new Error(`Adding ${carStep} cars would exceed this train type’s maximum of ${maxRouteCars}.`);
        }
        if (action === 'remove-car-set' && nextCars < minRouteCars) {
          throw new Error(`Removing ${carStep} cars would go below this train type’s minimum of ${minRouteCars}.`);
        }
        selectedRoute.carsPerTrain = nextCars;
        const updatedRoute = (api.gameState.getRoutes() as Route[]).find((route) => route.id === selectedRoute.id);
        if (updatedRoute?.carsPerTrain !== nextCars) {
          throw new Error('The route configuration is not writable through the game API in this build.');
        }
        refreshData();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setRouteActionError(message);
        console.error(`${MOD} Failed to update route ${selectedRoute.id}`, error);
      }
      refreshPanel?.();
    };
    const updateDemandSchedule = (key: DemandScheduleKey, change: -1 | 1): void => {
      if (!selectedRoute) return;
      try {
        setRouteActionError('');
        const schedule = selectedRoute.trainSchedule ?? {
          highDemand: 0,
          mediumDemand: 0,
          lowDemand: 0,
          veryLowDemand: 0,
        };
        const currentCount = demandScheduleCount(schedule, key);
        const nextCount = Math.max(0, currentCount + change);
        const scheduleKey = key === 'veryLowDemand' &&
          schedule.veryLowDemand === undefined && schedule.veryLow !== undefined
          ? 'veryLow'
          : key;
        schedule[scheduleKey] = nextCount;
        selectedRoute.trainSchedule = schedule;

        const updatedRoute = (api.gameState.getRoutes() as Route[]).find((route) => route.id === selectedRoute.id);
        const updatedCount = demandScheduleCount(updatedRoute?.trainSchedule, key);
        if (updatedCount !== nextCount) {
          throw new Error('The route demand schedule is not writable through the game API in this build.');
        }
        refreshData();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setRouteActionError(message);
        console.error(`${MOD} Failed to update route ${selectedRoute.id} demand schedule`, error);
      }
      refreshPanel?.();
    };

    return h('div', { style: { width: '100%', height: '100%', minWidth: 0, minHeight: 0, padding: '12px 5px', boxSizing: 'border-box', color: 'var(--foreground, inherit)', fontSize: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' } }, [
      h('div', { key: 'toolbar', style: { display: 'flex', gap: 6, marginBottom: 8, flexShrink: 0 } }, [
        selectedRouteId ? h('button', {
          key: 'back',
          type: 'button',
          onClick: () => setSelectedRouteId(null),
          style: { ...buttonStyle, flex: '0 0 auto' },
        }, 'Back') : null,
        h('button', { key: 'refresh', onClick: () => {
          try {
            refreshData();
          } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
          refreshPanel?.();
        }, style: { ...buttonStyle, flex: '1 1 auto', boxSizing: 'border-box' } }, 'Refresh'),
      ]),
      lastError ? h('div', { key: 'error', style: { color: '#ef4444', marginBottom: 8 } }, `Calculation error: ${lastError}`) : null,
      routeActionError ? h('div', { key: 'route-action-error', style: { color: '#ef4444', marginBottom: 8 } }, `Route update error: ${routeActionError}`) : null,
      selectedRouteId ? h('div', { key: 'route-details', style: { width: '100%', flex: '1 1 0', overflowY: 'auto', overflowX: 'hidden', minHeight: 0 } }, selectedRoute ? [
        h('h2', { key: 'name', style: { margin: '0 0 10px', color: selectedRoute.color || 'inherit', fontSize: 16 } }, selectedRoute.fullName || selectedRoute.name || selectedRoute.bullet || selectedRoute.id),
        h('div', { key: 'route-controls', style: { marginBottom: 12 } }, [
          h('div', { key: 'cars-control', style: adjustmentControlStyle }, [
            h('span', { key: 'label' }, `Cars/train: ${currentRouteCars || 'N/A'}`),
            h('div', { key: 'buttons', style: adjustmentButtonsStyle }, [
              h('button', {
                key: 'remove',
                type: 'button',
                'aria-label': `Remove ${carStep} cars per train`,
                title: currentRouteCars - carStep < minRouteCars
                  ? `Reached minimum of ${minRouteCars} cars per train`
                  : `Remove ${carStep} cars per train`,
                disabled: currentRouteCars - carStep < minRouteCars,
                onClick: () => updateRoute('remove-car-set'),
                style: currentRouteCars - carStep < minRouteCars
                  ? { ...removeButtonStyle, ...disabledButtonStyle }
                  : removeButtonStyle,
              }, '−'),
              h('button', {
                key: 'add',
                type: 'button',
                'aria-label': `Add ${carStep} cars per train`,
                title: currentRouteCars + carStep > maxRouteCars
                  ? `Reached maximum of ${maxRouteCars} cars per train`
                  : `Add ${carStep} cars per train`,
                disabled: currentRouteCars + carStep > maxRouteCars,
                onClick: () => updateRoute('add-car-set'),
                style: currentRouteCars + carStep > maxRouteCars
                  ? { ...addButtonStyle, ...disabledButtonStyle }
                  : addButtonStyle,
              }, '+'),
            ]),
          ]),
        ]),
        h('h3', { key: 'demand-title', style: sectionTitleStyle }, 'Trains by demand'),
        h('div', { key: 'demand-controls', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 10px', marginBottom: 12 } },
          demandScheduleLevels.map(({ key, label, color }) => {
            const count = demandScheduleCount(selectedRoute.trainSchedule, key);
            const cannotRemove = count <= 0;
            return h('div', { key, style: adjustmentControlStyle }, [
              h('span', { key: 'label', style: { color, fontSize: 14, fontWeight: 700 } }, `${label}: ${count}`),
              h('div', { key: 'buttons', style: adjustmentButtonsStyle }, [
                h('button', {
                  key: 'remove',
                  type: 'button',
                  'aria-label': `Remove one train for ${label.toLowerCase()}`,
                  title: cannotRemove
                    ? `Minimum is 0 trains for ${label.toLowerCase()}`
                    : `Remove one train for ${label.toLowerCase()}`,
                  disabled: cannotRemove,
                  onClick: () => updateDemandSchedule(key, -1),
                  style: cannotRemove ? { ...removeButtonStyle, ...disabledButtonStyle } : removeButtonStyle,
                }, '−'),
                h('button', {
                  key: 'add',
                  type: 'button',
                  'aria-label': `Add one train for ${label.toLowerCase()}`,
                  title: `Add one train for ${label.toLowerCase()}`,
                  onClick: () => updateDemandSchedule(key, 1),
                  style: addButtonStyle,
                }, '+'),
              ]),
            ]);
          })),
        h('div', { key: 'summary', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px', marginBottom: 12 } }, [
          h('div', { key: 'route-id' }, `Route ID: ${selectedRoute.id}`),
          h('div', { key: 'train-type' }, `Train type: ${selectedRoute.trainType || 'N/A'}`),
          h('div', { key: 'cars' }, `Cars per train: ${selectedRoute.carsPerTrain ?? selectedResult?.carsPerTrain ?? 'N/A'}`),
          h('div', { key: 'trains-per-hour' }, `Peak frequency: ${selectedResult ? selectedResult.peakPeriodTrainsPerHour.toFixed(2) : 'N/A'} tph`),
          h('div', { key: 'peak' }, [
            'Peak utilization: ',
            h('span', {
              key: 'value',
              style: { color: utilizationColor(selectedResult?.peakPeriodUtilizationPercent ?? null), fontWeight: 700 },
            }, formatPercent(selectedResult?.peakPeriodUtilizationPercent ?? null)),
          ]),
          h('div', { key: 'period' }, [
            'Peak period: ',
            h('span', {
              key: 'value',
              style: { color: demandColor(selectedResult?.peakPeriodDemand ?? null), fontWeight: 700 },
            }, selectedResult?.peakPeriodDemand ?? 'N/A'),
          ]),
        ]),
      ] : h('div', { key: 'missing-route', style: mutedTextStyle }, 'This route is no longer available. Refresh the dashboard or go back to the route list.')) : h('div', { key: 'table-scroll', style: { width: '100%', flex: '1 1 0', overflowY: 'auto', overflowX: 'hidden', minHeight: 0 } }, [
        h('table', { key: 'table', style: tableStyle }, [
          h('colgroup', { key: 'columns' }, columnWidths.map((width, index) => h('col', { key: index, style: { width: `${width}px` } }))),
          h('thead', { key: 'head' }, [
            h('tr', { key: 'columns' }, [
              h('th', { key: 'route', onClick: () => sortBy('route'), style: { ...sortableHeaderStyle, ...stickyHeaderStyle, textAlign: 'left' } }, sortLabel('route', 'Route')),
              h('th', { key: 'peak', onClick: () => sortBy('peak'), style: { ...sortableHeaderStyle, ...stickyHeaderStyle, textAlign: 'center' } }, sortLabel('peak', 'Peak')),
              h('th', { key: 'period', onClick: () => sortBy('period'), style: { ...sortableHeaderStyle, ...stickyHeaderStyle, textAlign: 'center' } }, sortLabel('period', 'Period')),
              h('th', { key: 'segment', style: { ...headerStyle, ...stickyHeaderStyle, textAlign: 'left' } }, 'Segment'),
              h('th', { key: 'frequency', onClick: () => sortBy('frequency'), style: { ...sortableHeaderStyle, ...compactHeaderStyle, ...stickyHeaderStyle, textAlign: 'left' }, title: 'Frequency' }, sortLabel('frequency', 'Freq.')),
              h('th', { key: 'cars', onClick: () => sortBy('cars'), style: { ...sortableHeaderStyle, ...compactHeaderStyle, ...stickyHeaderStyle, textAlign: 'left' } }, sortLabel('cars', 'Cars')),
            ]),
          ]),
          h('tbody', { key: 'body' }, rows.length ? rows : [h('tr', { key: 'empty' }, h('td', { colSpan: 6, style: cellStyle }, 'Loading data... Please wait.'))]),
        ]),
      ]),
    ]);
  }

  const cellStyle = { boxSizing: 'border-box', padding: '4px 2px', verticalAlign: 'top', borderBottom: '1px solid var(--border, #444)', overflow: 'hidden' };
  const headerStyle = { ...cellStyle, background: 'var(--card, #222)' };
  const compactCellStyle = { ...cellStyle, whiteSpace: 'nowrap' };
  const compactHeaderStyle = { boxSizing: 'border-box', padding: '4px 2px', whiteSpace: 'nowrap', overflow: 'hidden' };
  const clippedCellStyle = { ...cellStyle, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
  const stickyHeaderStyle = { position: 'sticky', top: 0, zIndex: 1, background: 'var(--card, #222)' };
  const buttonStyle = { padding: '6px 10px', border: '1px solid #000', borderRadius: 6, cursor: 'pointer', background: '#fff', color: '#000' };
  const routeLinkStyle = { display: 'block', width: '100%', overflow: 'hidden', padding: 0, border: 0, background: 'transparent', font: 'inherit', textAlign: 'left' as const, textDecoration: 'underline', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' };
  const sectionTitleStyle = { margin: '10px 0 5px', fontSize: 13 };
  const mutedTextStyle = { color: 'var(--muted-foreground, #aaa)', marginBottom: 10 };
  const adjustmentControlStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4 };
  const adjustmentButtonsStyle = { display: 'flex', gap: 6 };
  const adjustmentButtonStyle = { ...buttonStyle, flex: '1 1 0', padding: '3px 8px' };
  const removeButtonStyle = { ...adjustmentButtonStyle, background: '#ef4444', color: '#fff', borderColor: '#b91c1c' };
  const addButtonStyle = { ...adjustmentButtonStyle, background: '#22c55e', color: '#fff', borderColor: '#15803d' };
  const disabledButtonStyle = { background: '#9ca3af', color: '#fff', borderColor: '#6b7280', cursor: 'not-allowed' };

  try {
    api.hooks?.onGameInit?.(() => {
      sampleIfDue(true);
      api.ui?.showNotification?.('Peak Utilization loaded. Open the panel to view routes.', 'success');
    });
    api.hooks?.onGameLoaded?.(() => {
      lastSampleTime = null;
      sampleIfDue(true);
    });
    api.hooks?.onHourChange?.(() => sampleIfDue(false));
    api.ui?.addFloatingPanel?.({
      id: 'peak-utilization-dashboard',
      title: 'Peak Utilization',
      icon: 'ChartNoAxesCombined',
      defaultWidth: 480,
      defaultHeight: 640,
      defaultPosition: { x: 40, y: 80 },
      render: () => {
        const React = api.utils?.React;
        return React ? React.createElement(renderPanel) : renderPanel();
      },
    });
    window.addEventListener('keydown', closeDashboardOnEscape, true);
    // Poll less often; samples are still only recorded every 10 in-game minutes.
    window.setInterval(() => sampleIfDue(false), 10_000);
    sampleIfDue(true);
    console.info(`${MOD} loaded. This prototype is read-only; it does not modify route settings.`);
  } catch (error) {
    console.error(`${MOD} failed to initialize`, error);
    api.ui?.showNotification?.('Peak Utilization could not initialize. Check the console for details.', 'error');
  }
}
