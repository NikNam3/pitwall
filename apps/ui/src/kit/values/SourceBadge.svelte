<script lang="ts">
  // The source badge after a value that rests on a prior (spec 4.4): the unit decided the source's kind (C43); the badge
  // maps the kind to its mark and shows the parts on hover (C65). No mark for a value measured this session.
  import type { EstimateSource } from '@pitwall/domain';
  import { sourceMark } from '../text.ts';
  import { sourceTitle } from './source-badge.ts';

  let { source }: { source: EstimateSource } = $props();

  const title = $derived(sourceTitle(source));
</script>

<span class="source-badge" {title}>{sourceMark[source.kind]}</span>

<style>
  .source-badge {
    color: var(--pw-textFaint);
  }
</style>
