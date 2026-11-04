import type { SessionInfo } from '@pitwall/contracts';
import type { SessionState } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine/readers';
import { bindState, defineFeature } from '../feature.ts';

const sessionInfo: QuickCalculator<SessionInfo> = {
  id: 'session.info',
  kind: 'quick',
  reads: ['session', 'identity'],
  cadence: 'sessionChange',
  compute: ({ live }) => ({
    feedId: live.feedId,
    sessionUid: live.sessionUid,
    playerCar: live.playerCar,
    ...(live.teammateCar !== undefined && { teammateCar: live.teammateCar }),
    realism: live.realism,
    session: structuredClone(live.session) as SessionState,
  }),
};

export default defineFeature({
  name: 'session-info',
  calculators: [sessionInfo],
  topics: [bindState('session.info', sessionInfo)],
});
