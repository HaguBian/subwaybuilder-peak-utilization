import type {
  CompletedCommute, Route, RouteUtilization, SegmentLoad, Station, Train,
  TrainType, TrainTypeStats,
} from './types';

const SAMPLE_SECONDS = 600;
const SECONDS_PER_DAY = 86_400;
const TRANSITION_WINDOW_MAX_SECONDS = 5_400;
const DEFAULT_TRANSITION_SECONDS = 1_800;

export const PERIODS = [
  { id: 'all-day', label: 'All day', startHour: 0, endHour: 24 },
  { id: 'late-night', label: 'Late Night (00–03)', startHour: 0, endHour: 3 },
  { id: 'early-morning', label: 'Early Morning (03–06)', startHour: 3, endHour: 6 },
  { id: 'early-morning-rush', label: 'Early Morning Rush (06–07)', startHour: 6, endHour: 7 },
  { id: 'peak-morning-rush', label: 'Peak Morning Rush (07–10)', startHour: 7, endHour: 10 },
  { id: 'late-morning-rush', label: 'Late Morning Rush (10–11)', startHour: 10, endHour: 11 },
  { id: 'midday', label: 'Midday (11–15)', startHour: 11, endHour: 15 },
  { id: 'early-evening-rush', label: 'Early Evening Rush (15–16)', startHour: 15, endHour: 16 },
  { id: 'peak-evening-rush', label: 'Peak Evening Rush (16–19)', startHour: 16, endHour: 19 },
  { id: 'late-evening-rush', label: 'Late Evening Rush (19–20)', startHour: 19, endHour: 20 },
  { id: 'early-night', label: 'Early Night (20–23)', startHour: 20, endHour: 23 },
  { id: 'night', label: 'Night (23–24)', startHour: 23, endHour: 24 },
] as const;
export type PeriodId = typeof PERIODS[number]['id'];

export const DEMAND_LEVELS = [
  { id: 'high', label: 'High (07–10, 16–19)', hours: [7, 8, 9, 16, 17, 18] },
  { id: 'medium', label: 'Medium (05–06, 10–11, 12–13, 20–23)', hours: [5, 10, 12, 20, 21, 22] },
  { id: 'low', label: 'Low (03–05, 06–07, 11–12, 13–16, 19–20)', hours: [3, 4, 6, 11, 13, 14, 15, 19] },
  { id: 'very-low', label: 'Very Low (00–03, 23–24)', hours: [0, 1, 2, 23] },
] as const;
export type DemandLevelId = typeof DEMAND_LEVELS[number]['id'];

type AnalysisPeriod = {
  id: string;
  label: string;
  startHour?: number;
  endHour?: number;
  hours?: readonly number[];
};

const HOUR_DEMAND: Record<number, 'high' | 'medium' | 'low' | 'veryLow'> = {
  0: 'veryLow', 1: 'veryLow', 2: 'veryLow', 3: 'low', 4: 'low', 5: 'medium',
  6: 'low', 7: 'high', 8: 'high', 9: 'high', 10: 'medium', 11: 'low',
  12: 'medium', 13: 'low', 14: 'low', 15: 'low', 16: 'high', 17: 'high',
  18: 'high', 19: 'low', 20: 'medium', 21: 'medium', 22: 'medium', 23: 'veryLow',
};

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function demandCount(route: Route, demand: string): number {
  const s = route.trainSchedule;
  if (!s) return 0;
  switch (demand) {
    case 'high': return finite(s.highDemand);
    case 'medium': return finite(s.mediumDemand);
    case 'low': return finite(s.lowDemand);
    case 'veryLow': return finite(s.veryLowDemand ?? s.veryLow);
    default: return 0;
  }
}
function clockSeconds(seconds: number): number {
  return Math.floor((((seconds % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY) / 60) * 60;
}
function routeCycleTime(route: Route): number {
  const timings = route.stComboTimings ?? [];
  const last = timings[timings.length - 1];
  return finite(last?.departureTime) > 0 ? finite(last?.departureTime) : DEFAULT_TRANSITION_SECONDS;
}
function countFromHeadway(cycleTime: number, headwaySeconds: number): number {
  return headwaySeconds > 0 && cycleTime > 0 ? Math.ceil(cycleTime / headwaySeconds) : 0;
}
function activeTimetablePeriod(route: Route, seconds: number) {
  const periods = route.timetableSchedule?.periods ?? [];
  const hour = ((((seconds % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY) / 3600);
  return periods.find((p) => p.startHour < p.endHour
    ? hour >= p.startHour && hour < p.endHour
    : hour >= p.startHour || hour < p.endHour) ?? null;
}
function idealTrainCountAt(route: Route, seconds: number): number {
  const timetable = route.timetableSchedule;
  const cycleTime = routeCycleTime(route);
  if (timetable?.mode === 'timetable') {
    const period = activeTimetablePeriod(route, seconds);
    return period ? countFromHeadway(cycleTime, finite(period.headwaySeconds)) : 0;
  }
  if (!route.trainSchedule) return 0;
  const now = clockSeconds(seconds);
  const hour = Math.floor(now / 3600);
  const base = demandCount(route, HOUR_DEMAND[hour]);
  const window = Math.min(cycleTime > 0 ? cycleTime : DEFAULT_TRANSITION_SECONDS, TRANSITION_WINDOW_MAX_SECONDS);
  for (let h = 0; h < 24; h++) {
    const next = (h + 1) % 24;
    const from = HOUR_DEMAND[h], to = HOUR_DEMAND[next];
    if (from === to) continue;
    const boundary = next * 3600, start = boundary - window, end = boundary + window;
    let inside = false, elapsed = 0;
    if (start < 0) {
      const wrapped = SECONDS_PER_DAY + start;
      inside = now >= wrapped || now <= end;
      elapsed = now >= wrapped ? now - wrapped : SECONDS_PER_DAY - wrapped + now;
    } else if (end > SECONDS_PER_DAY) {
      const wrapped = end - SECONDS_PER_DAY;
      inside = now >= start || now <= wrapped;
      elapsed = now >= start ? now - start : SECONDS_PER_DAY - start + now;
    } else {
      inside = now >= start && now <= end;
      elapsed = now - start;
    }
    if (inside) {
      const progress = Math.max(0, Math.min(1, elapsed / (window * 2)));
      return Math.round(demandCount(route, from) + (demandCount(route, to) - demandCount(route, from)) * progress);
    }
  }
  return base;
}
function inPeriod(seconds: number, period: AnalysisPeriod): boolean {
  const hour = seconds / 3600;
  if (period.hours) return period.hours.includes(Math.floor(hour));
  return period.startHour !== undefined && period.endHour !== undefined
    && hour >= period.startHour && hour < period.endHour;
}

function demandForPeriod(period: AnalysisPeriod): DemandLevelId {
  let periodHours = period.hours;
  if (!periodHours && period.startHour !== undefined && period.endHour !== undefined) {
    const startHour = Math.floor(period.startHour);
    const endHour = Math.ceil(period.endHour);
    periodHours = Array.from(
      { length: Math.max(0, endHour - startHour) },
      (_unused, index) => startHour + index,
    );
  }
  periodHours ??= [];
  return DEMAND_LEVELS.reduce((best, level) => {
    const matches = level.hours.filter((hour) => periodHours.includes(hour)).length;
    const bestMatches = best.hours.filter((hour) => periodHours.includes(hour)).length;
    return matches > bestMatches ? level : best;
  }, DEMAND_LEVELS[0]).id;
}

type IndexedRouteCommute = {
  journeySeconds: number;
  size: number;
  stationRoutes: NonNullable<CompletedCommute['stationRoutes']>;
};

type CalculationContext = {
  nodeToStation: Map<string, string>;
  commutesByRoute: Map<string, IndexedRouteCommute[]>;
};

function createCalculationContext(stations: Station[], commutes: CompletedCommute[]): CalculationContext {
  const nodeToStation = new Map<string, string>();
  for (const station of stations) {
    for (const nodeId of station.stNodeIds ?? []) nodeToStation.set(nodeId, station.id);
  }

  const commutesByRoute = new Map<string, IndexedRouteCommute[]>();
  for (const commute of commutes) {
    const stationRoutesByRoute = new Map<string, NonNullable<CompletedCommute['stationRoutes']>>();
    for (const stationRoute of commute.stationRoutes ?? []) {
      const entries = stationRoutesByRoute.get(stationRoute.routeId) ?? [];
      entries.push(stationRoute);
      stationRoutesByRoute.set(stationRoute.routeId, entries);
    }
    for (const [routeId, stationRoutes] of stationRoutesByRoute) {
      const entries = commutesByRoute.get(routeId) ?? [];
      entries.push({
        journeySeconds: ((finite(commute.journeyStart) % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY,
        size: Math.max(0, finite(commute.size)),
        stationRoutes,
      });
      commutesByRoute.set(routeId, entries);
    }
  }
  return { nodeToStation, commutesByRoute };
}

function tripsForPeriods(route: Route, routes: Route[], trains: Train[], periods: AnalysisPeriod[]): number[] {
  const cycleTime = routeCycleTime(route);
  if (cycleTime <= 0) return periods.map(() => 0);
  const scheduled = !!route.trainSchedule || route.timetableSchedule?.mode === 'timetable';
  if (scheduled) {
    const trainSeconds = periods.map(() => 0);
    for (let seconds = 0; seconds < SECONDS_PER_DAY; seconds += SAMPLE_SECONDS) {
      const trainCount = idealTrainCountAt(route, seconds);
      for (let index = 0; index < periods.length; index++) {
        if (inPeriod(seconds, periods[index])) trainSeconds[index] += trainCount * SAMPLE_SECONDS;
      }
    }
    return trainSeconds.map((seconds) => seconds / cycleTime);
  }
  const childIds = new Set(routes.filter((r) => r.tempParentId === route.id).map((r) => r.id));
  const count = trains.filter((t) => t.routeId === route.id || childIds.has(t.routeId)).length;
  return periods.map((period) => {
    const durationHours = period.hours?.length
      ?? (period.startHour !== undefined && period.endHour !== undefined ? period.endHour - period.startHour : 0);
    return count * durationHours * 3600 / cycleTime;
  });
}
function getSegmentLoadsByPeriod(
  route: Route,
  context: CalculationContext,
  periods: AnalysisPeriod[],
) {
  const combos = route.stCombos ?? [];
  const loadsByPeriod = periods.map(() => new Map<number, number>());
  for (const loads of loadsByPeriod) combos.forEach((_combo, i) => loads.set(i, 0));
  const commuteEntries = context.commutesByRoute.get(route.id) ?? [];
  for (const commute of commuteEntries) {
    const matchingPeriods = periods
      .map((period, index) => inPeriod(commute.journeySeconds, period) ? index : -1)
      .filter((index) => index >= 0);
    if (matchingPeriods.length === 0) continue;
    for (const sr of commute.stationRoutes) {
      const ids = sr.stationIds ?? [], fromId = ids[0], toId = ids[1];
      if (!fromId || !toId || !combos.length) continue;
      let bestPath: number[] | null = null, bestDistance = Number.POSITIVE_INFINITY;
      for (let startIdx = 0; startIdx < combos.length; startIdx++) {
        if (context.nodeToStation.get(String(combos[startIdx]?.startStNodeId ?? '')) !== fromId) continue;
        const path: number[] = []; let distance = 0;
        for (let step = 0; step < combos.length; step++) {
          const idx = (startIdx + step) % combos.length, combo = combos[idx];
          path.push(idx); distance += finite(combo?.distance) || 1;
          if (context.nodeToStation.get(String(combo?.endStNodeId ?? '')) === toId) {
            if (distance < bestDistance) { bestDistance = distance; bestPath = [...path]; }
            break;
          }
        }
      }
      if (bestPath) {
        for (const periodIndex of matchingPeriods) {
          const loads = loadsByPeriod[periodIndex];
          for (const idx of bestPath) loads.set(idx, (loads.get(idx) ?? 0) + commute.size);
        }
      }
    }
  }
  return loadsByPeriod.map((loads) => combos.map((combo, comboIdx) => ({
    comboIdx,
    fromStationId: context.nodeToStation.get(String(combo.startStNodeId ?? '')) ?? null,
    toStationId: context.nodeToStation.get(String(combo.endStNodeId ?? '')) ?? null,
    passengerCount: loads.get(comboIdx) ?? 0,
  })));
}
function calculateForPeriod(
  cars: number,
  stats: TrainTypeStats,
  tripsPerDay: number,
  segmentLoads: ReturnType<typeof getSegmentLoadsByPeriod>[number],
) {
  const capacityPerTrain = cars * Math.max(0, finite(stats.capacityPerCar));
  const totalCapacity = tripsPerDay * capacityPerTrain;
  const segments = segmentLoads.map((seg) => ({
    ...seg,
    utilizationPercent: totalCapacity > 0 ? seg.passengerCount / totalCapacity * 100 : null,
  }));
  const bottleneck = segments.filter((s) => s.utilizationPercent !== null).reduce<SegmentLoad | null>((best, s) =>
    !best || (s.utilizationPercent ?? -1) > (best.utilizationPercent ?? -1) ? s : best, null);
  return { carsPerTrain: cars, capacityPerTrain, tripsPerDay, segments, bottleneck, peak: bottleneck?.utilizationPercent ?? null };
}
function calculateRouteUtilizationWithContext(args: {
  route: Route; routes: Route[]; stations: Station[]; trains: Train[]; commutes: CompletedCommute[]; trainTypes: TrainType[]; expectedPeriod?: DemandLevelId; currentHour?: number;
}, context: CalculationContext): RouteUtilization {
  const { route, routes, trains, trainTypes } = args;
  const trainTypeId = route.trainType ?? '';
  const stats = trainTypes.find((t) => t.id === trainTypeId)?.stats ?? {};
  const allDay = PERIODS[0];
  const expectedPeriod = DEMAND_LEVELS.find((p) => p.id === (args.expectedPeriod ?? 'high')) ?? DEMAND_LEVELS[0];
  const currentHour = Math.max(0, Math.min(23, Math.floor(finite(args.currentHour))));
  const actPeriod = PERIODS.find((p) => currentHour >= p.startHour && currentHour < p.endHour) ?? PERIODS[0];
  const periods: AnalysisPeriod[] = [allDay, actPeriod, ...PERIODS.slice(1), expectedPeriod];
  const segmentLoads = getSegmentLoadsByPeriod(route, context, periods);
  const trips = tripsForPeriods(route, routes, trains, periods);
  const cars = Math.max(0, finite(route.carsPerTrain, finite(trains.find((t) => t.routeId === route.id)?.cars, finite(stats.minCars))));
  const periodResults = periods.map((_period, index) =>
    calculateForPeriod(cars, stats, trips[index], segmentLoads[index]));
  const all = periodResults[0];
  const act = periodResults[1];
  const expectedIndex = periods.findIndex((period) => period.id === expectedPeriod.id);
  const expected = periodResults[expectedIndex];
  let peakPeriodIndex = -1;
  for (let index = 2; index < periods.length - 1; index++) {
    const value = periodResults[index].peak;
    const peakValue = peakPeriodIndex < 0 ? null : periodResults[peakPeriodIndex].peak;
    if (value !== null && (peakValue === null || value > peakValue)) peakPeriodIndex = index;
  }
  const peakPeriod = peakPeriodIndex >= 0 ? periods[peakPeriodIndex] : null;
  const peakPeriodUtilization = peakPeriodIndex >= 0 ? periodResults[peakPeriodIndex].peak : null;
  const peakPeriodResult = peakPeriodIndex >= 0 ? periodResults[peakPeriodIndex] : null;
  const peakPeriodHours = peakPeriod
    ? peakPeriod.hours?.length
      ?? (peakPeriod.startHour !== undefined && peakPeriod.endHour !== undefined
        ? peakPeriod.endHour - peakPeriod.startHour
        : 0)
    : 0;
  const peakPeriodTrainsPerHour = peakPeriodResult && peakPeriodHours > 0
    ? peakPeriodResult.tripsPerDay / peakPeriodHours
    : 0;
  const peakPeriodTrainLimit = Math.min(42, finite(stats.tphLimit, 42));
  const carsLimit = Math.min(15, finite(stats.maxCars, 15));
  const routeTrains = trains.filter((t) => t.routeId === route.id);
  const routeName = route.fullName || route.name || (route.bullet && !/^#?[0-9a-f]{3,8}$/i.test(route.bullet) ? route.bullet : '') || route.id;
  return {
    routeId: route.id, routeName, routeColor: typeof route.color === 'string' ? route.color : undefined, trainType: trainTypeId || 'unknown',
    carsPerTrain: all.carsPerTrain, capacityPerTrain: all.capacityPerTrain,
    tripsPerDay: all.tripsPerDay, dailySeatCapacity: all.tripsPerDay * all.capacityPerTrain,
    peakUtilizationPercent: all.peak, actUtilizationPercent: act.peak,
    peakPeriodUtilizationPercent: peakPeriodUtilization, peakPeriodId: peakPeriod?.id ?? null,
    peakPeriodDemand: peakPeriod ? demandForPeriod(peakPeriod) : null,
    peakPeriodBottleneck: peakPeriodResult?.bottleneck ?? null,
    peakPeriodTrainsPerHour,
    peakPeriodTrainLimit,
    carsLimit,
    expectedUtilizationPercent: expected.peak, expectedBottleneck: expected.bottleneck,
    bottleneck: all.bottleneck, segments: all.segments,
    trainsPerHour: all.tripsPerDay / 24, physicalTrainCount: routeTrains.length,
    status: all.capacityPerTrain <= 0 || all.tripsPerDay <= 0 ? 'no-capacity' : all.segments.length === 0 ? 'no-segments' : 'ok',
  };
}

export function calculateRouteUtilization(args: {
  route: Route; routes: Route[]; stations: Station[]; trains: Train[]; commutes: CompletedCommute[]; trainTypes: TrainType[]; expectedPeriod?: DemandLevelId; currentHour?: number;
}): RouteUtilization {
  return calculateRouteUtilizationWithContext(args, createCalculationContext(args.stations, args.commutes));
}

export function calculateAllRoutes(api: any, expectedPeriod: DemandLevelId = 'high'): RouteUtilization[] {
  const routes = api.gameState.getRoutes() as Route[];
  const stations = api.gameState.getStations() as Station[];
  const trains = api.gameState.getTrains() as Train[];
  const commutes = (api.gameState.getCompletedCommutes() ?? []) as CompletedCommute[];
  const currentHour = finite(api.gameState.getCurrentHour?.());
  let trainTypes: TrainType[] = [];
  try {
    const raw = api.trains?.getTrainTypes?.();
    if (Array.isArray(raw)) trainTypes = raw;
    else if (raw && typeof raw === 'object') trainTypes = Object.entries(raw).map(([id, value]: [string, any]) => ({ id, ...value }));
  } catch (error) { console.warn('[Peak Utilization] Could not read train type stats:', error); }
  const context = createCalculationContext(stations, commutes);
  return routes.map((route) => calculateRouteUtilizationWithContext(
    { route, routes, stations, trains, commutes, trainTypes, expectedPeriod, currentHour },
    context,
  ));
}
