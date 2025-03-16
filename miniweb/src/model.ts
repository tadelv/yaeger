
// WebSocket message type
export type YaegerMessage = {
  ET: number;
  BT: number;
  Amb: number;
  FanVal: number;
  BurnerVal: number;
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
	steps: ProfileStep[]
}

export type ProfileStep = {
	interpolation: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
	setpoint: number
	duration: number
}
