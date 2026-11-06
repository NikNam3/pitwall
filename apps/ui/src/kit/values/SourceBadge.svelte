<script lang="ts">
  // The source badge after a value that rests on a prior (spec 4.4): the unit decided the source's kind (C43); the badge
  // maps the kind to its mark and shows the parts on hover (C65). No mark for a value measured this session.
  import type { EstimateSource } from '@pitwall/domain';
  import { sourceHover, sourceMark } from '../text.ts';

  let { source }: { source: EstimateSource } = $props();

  const title = $derived.by((): string => {
    switch (source.kind) {
      case 'session':
        return sourceHover.session(source.parts);
      case 'calibration':
        return sourceHover.calibration(source.setName, source.sources, source.parts);
      case 'default':
        return sourceHover.default(source.note);
    }
  });
</script>

<span class="source-badge" {title}>{sourceMark[source.kind]}</span>

<style>
  .source-badge {
    color: var(--pw-textFaint);
  }
</style>
