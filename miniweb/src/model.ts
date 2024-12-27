
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
}

export type RoastState = {
	startDate: Date
	measurements: [Measurement] | []
}
