import type { SessionInfo } from '@pitwall/contracts';
import type { SessionState } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine';
import { bindState, defineFeature } from '../feature.ts';

const sessionInfo: QuickCalculator<SessionInfo> = {
  id: 'session.info',
  kind: 'quick',
  reads: ['session', 'identity'],
  cadence: 'sessionChange',
  compute: ({ state }) => ({
    feedId: state.feedId,
    sessionUid: state.sessionUid,
    playerCar: state.playerCar,
    ...(state.teammateCar !== undefined && { teammateCar: state.teammateCar }),
    session: structuredClone(state.session) as SessionState,
  }),
};

export default defineFeature({
  name: 'session-info',
  calculators: [sessionInfo],
  topics: [bindState('session.info', sessionInfo)],
});
