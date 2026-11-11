import type { EstimateSource } from '@pitwall/domain';
import { sourceHover } from '../text.ts';

/**
 * The source badge's hover in words (spec 4.4), the kit's one switch on the source kind: `SourceBadge` shows it, and a
 * display that names the source in words gives its cell the same hover. The unit decided the kind (C43).
 */
export function sourceTitle(source: EstimateSource): string {
  switch (source.kind) {
    case 'session':
      return sourceHover.session(source.parts);
    case 'calibration':
      return sourceHover.calibration(source.setName, source.sources, source.parts);
    case 'profile':
      return sourceHover.profile(source.person, source.laps, source.parts);
    case 'default':
      return sourceHover.default(source.note);
  }
}
