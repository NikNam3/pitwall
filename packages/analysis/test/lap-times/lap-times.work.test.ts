// `lap-times` justifies its accumulator by counted work on the long race (contract C31): its reads at lap 7 and lap 70
// (C31.1) and its accumulator from the projection alone (C31.2); its C31.3 property is in incremental-rewind.property.test.ts.
import { describeWork } from '../work.ts';

describeWork('lap-times');
