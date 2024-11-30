
// maybe instead of using separate interfaces, use a composite event?
// this way I can keep one array for all events
// for easier showing on the chart
export interface YaegerEvent {
	timestamp: Date;
}

	// current readings
export interface YaegerReading extends YaegerEvent {
	reading: YaegerMessage;
}

export interface YaegerLabel extends YaegerEvent {
	label: string;
}

export interface YaegerCommand extends YaegerEvent {
	timestamp: Date;
}
export interface YaegerMessage {
  ET: Number;
  BT: Number;
  Amb: Number;
  FanVal: Number;
  BurnerVal: Number;
  id: Number;
}

export interface RoastReport {
	start: Date;
	events: [YaegerEvent];
}
