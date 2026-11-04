// `pace` justifies its accumulator by counted work on the long race (contract C31): its reads at lap 7 and lap 70
// (C31.1), its accumulator from the projection alone (C31.2) and incremental = from scratch across rewinds (C31.3).
import { describeWork } from '../work.ts';

describeWork('pace');
