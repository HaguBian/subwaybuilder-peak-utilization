/** Minimal runtime shapes used by Peak Utilization. Fields are optional because
 * Subway Builder may omit fields for temporary or incomplete routes. */
export interface RouteCombo {
  startStNodeId?: string;
  endStNodeId?: string;
  distance?: number;
}

export interface RouteTiming {
  departureTime?: number;
}

export interface TrainSchedule {
  highDemand?: number;
  mediumDemand?: number;
  lowDemand?: number;
  veryLowDemand?: number;
  veryLow?: number;
}

export interface TimetablePeriod {
  startHour: number;
  endHour: number;
  headwaySeconds: number;
}

export interface Route {
  id: string;
  name?: string;
  fullName?: string;
  bullet?: string;
  color?: string;
  trainType?: string;
  carsPerTrain?: number;
  idealTrainCount?: number;
  tempParentId?: string | null;
  stCombos?: RouteCombo[];
  stComboTimings?: RouteTiming[];
  trainSchedule?: TrainSchedule;
  timetableSchedule?: {
    mode?: string;
    periods?: TimetablePeriod[];
  };
}

export interface Station {
  id: string;
  name?: string;
  stNodeIds?: string[];
}

export interface Train {
  id: string;
  routeId: string;
  cars?: number;
  trainType?: string;
  length?: number;
  specs?: { maxCapacity?: number };
}

export interface StationRoute {
  routeId: string;
  stationIds?: [string, string] | string[];
}

export interface CompletedCommute {
  size?: number;
  journeyStart?: number;
  stationRoutes?: StationRoute[];
}

export interface TrainTypeStats {
  capacityPerCar?: number;
  minCars?: number;
  maxCars?: number;
  carsPerCarSet?: number;
  tphLimit?: number;
}

export interface TrainType {
  id: string;
  name?: string;
  stats?: TrainTypeStats;
}

export interface SegmentLoad {
  comboIdx: number;
  fromStationId: string | null;
  toStationId: string | null;
  passengerCount: number;
  utilizationPercent: number | null;
}

export interface RouteUtilization {
  routeId: string;
  routeName: string;
  routeColor?: string;
  trainType: string;
  carsPerTrain: number;
  capacityPerTrain: number;
  tripsPerDay: number;
  dailySeatCapacity: number;
  peakUtilizationPercent: number | null;
  peakPeriodUtilizationPercent: number | null;
  peakPeriodId: string | null;
  peakPeriodDemand: string | null;
  peakPeriodBottleneck: SegmentLoad | null;
  peakPeriodTrainsPerHour: number;
  peakPeriodTrainLimit: number;
  carsLimit: number;
  actUtilizationPercent: number | null;
  expectedUtilizationPercent: number | null;
  expectedBottleneck: SegmentLoad | null;
  bottleneck: SegmentLoad | null;
  segments: SegmentLoad[];
  trainsPerHour: number;
  physicalTrainCount: number;
  status: 'ok' | 'no-capacity' | 'no-segments';
}
