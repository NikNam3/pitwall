// `incidents-history` justifies its accumulator by counted work on the long race (contract C31): its reads at lap 7 and lap 70
// (C31.1), its accumulator from the projection and the config alone (C31.2) and incremental = from scratch across
// rewinds (C31.3).
import { describeFold } from '../work.ts';

describeFold('incidents-history');
