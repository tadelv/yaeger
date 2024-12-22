
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
	currentState: CurrentState = {};
}

export type CurrentState = {
	lastMessage?: YaegerMessage 
	lastUpdate?: Date
}

export type Measurement = {
	timestamp: Date
	message: YaegerMessage
}

export type RoastState = {
	startDate: Date
	measurements: [Measurement] | []
}
