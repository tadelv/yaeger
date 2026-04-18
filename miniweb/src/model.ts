
// WebSocket message type
export type YaegerMessage = {
  ET: number;
  BT: number;
  simBT?: number;
  Amb: number;
  sampleAgeMs?: number;
  sensorOk?: boolean;
  FanVal: number;
  BurnerVal: number;
  btRoR?: number;
  etRoR?: number;
  pidCurrentTemp?: number;
  pidError?: number;
  pidIntegral?: number;
  pidDerivative?: number;
  pidOutput?: number;
  pidOutputSmoothed?: number;
  pidPredictedTemp?: number;
  pidTempSlope?: number;
  pidProcessDelaySec?: number;
  pidPredictorEnabled?: boolean;
  pidEnabled?: boolean;
  pidDelayMeasureState?: "idle" | "stabilizing" | "heating" | "complete" | "failed";
  pidDelayMeasureElapsedSec?: number;
  pidMeasuredProcessDelaySec?: number;
  pidDelayFan?: number;
  pidDelayHeater?: number;
  setpoint?: number;
  controlMode?: "pid" | "adrc";
  autotuneMode?: "pid" | "adrc";
  pidTarget?: "BT" | "ET" | "simBT";
  pidTuneMethod?: "ziegler-nichols" | "tyreus-luyben" | "pessen-integral" | "no-overshoot";
  pidAutotune?: boolean;
  adrcAutotune?: boolean;
  pidAutotuneCrossings?: number;
  pidAutotuneTargetCrossings?: number;
  pidAutotunePeakHigh?: number;
  pidAutotunePeakLow?: number;
  pidAutotuneKu?: number;
  pidAutotunePu?: number;
  pidAutotuneElapsedSec?: number;
  pidAutotuneEtaSec?: number;
  pidAutotuneHeaterCommand?: number;
  pidAutotuneMin?: number;
  pidAutotuneMax?: number;
  pidAutotuneRelayHigh?: boolean;
  pidAutotuneCyclePeak?: number;
  pidAutotuneAvgPeakHigh?: number;
  pidAutotuneAvgPeakLow?: number;
  pidAutotuneHighPeakCount?: number;
  pidAutotuneLowPeakCount?: number;
  pidKpActive?: number;
  pidKiActive?: number;
  pidKdActive?: number;
  controlFanMin?: number;
  controlFanMax?: number;
  adrcB0?: number;
  adrcW0?: number;
  adrcWc?: number;
  adrcZ1?: number;
  adrcZ2?: number;
  adrcZ3?: number;
  adrcLastCommand?: number;
  adrcAutotunePeakSlope?: number;
  adrcAutotuneElapsedSec?: number;
  adrcAutotunePhase?: "idle" | "baseline" | "step" | "applying";
  adrcAutotuneBaselineTemp?: number;
  adrcAutotuneHeaterStep?: number;
  adrcAutotuneBaselineSamples?: number;
  emergencyStopActive?: boolean;
  id: number;
}

export class YaegerState  {
	roast?: RoastState
	currentState: CurrentState =  {
		status: RoasterStatus.idle
	};
	profile?: Profile
}

export enum RoasterStatus {
	idle,
	roasting
}

export type CurrentState = {
	lastMessage?: YaegerMessage 
	lastUpdate?: Date
	status: RoasterStatus 
}

export type Measurement = {
	timestamp: Date
	message: YaegerMessage
	extra?: MeasurementExtra
}

export type MeasurementExtra = {
	setpoint: number
	pidData?: PIDData
}

export type RoastState = {
	startDate: Date
	measurements: Measurement[] | []
	events: RoastEvent[] | []
	commands: RoastCommand[] | []
	profile?: Profile
}

export type RoastEvent = {
	label: String
	measurement: Measurement
}

export type RoastCommand = {
	type: 'fan' | 'heater'
	value: number
	timestamp: Date
}

export type PIDData = {
	enabled: boolean
	kp: number
	ki: number
	kd: number
}

export type Profile = {
	name?: string
	steps: ProfileStep[]
}

export type ProfileStep = {
	name?: string
	tag?: string
	interpolation: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
	setpoint: number
	duration: number
  fanValue?: number
}
