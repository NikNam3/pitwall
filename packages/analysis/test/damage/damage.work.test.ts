// `damage` is quick (contract C31, ruling Task 22 round 2): it reads its fold `damage-history`, and its own from-scratch reads do
// not grow fivefold from lap 7 to lap 70 (C31.1).
import { describeQuick } from '../work.ts';

describeQuick('damage');
