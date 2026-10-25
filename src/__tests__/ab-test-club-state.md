# A/B Test: Club Screen Error State Messaging

## Hypothesis

**Because** users experiencing fetch failures on the club screen currently see generic error states without clear recovery actions, **we believe** implementing consistent error classification with "Coba lagi" recovery messaging via the `isFetchFailure` function will increase successful retry rates by 15%+ for network errors. **We'll know this is true** when the retry click-through rate improves for network-classified errors versus the current generic error state, measured over a 2-week test period with minimum 1,200 participants per variant.

## Background

The club screen (`src/app/club.tsx`) recently received error handling improvements using `isFetchFailure` from `src/features/auth/errors.ts`. The new classification properly distinguishes:
- `missing` state when club is not found (error code `not_found`)
- `error` state with proper network error classification when fetch fails (via `isFetchFailure`)
- `ready` state when club data loads successfully

However, the A/B test will verify whether this improved error classification actually improves user engagement with the recovery actions.

## Variants

| Variant | Description | Change |
|---------|-------------|--------|
| **A (Control)** | Current error state: Generic error message without "Coba lagi" specific to network errors | Users see generic error state for all error types |
| **B (Treatment)** | Improved error state: Network errors show "Gagal memuat klub. Coba lagi" with `isFetchFailure` classification; `not_found` errors show "Klub tidak ditemukan" | Network errors get recovery messaging via `isFetchFailure`; missing club gets explicit "not_found" message |

## Primary Metric

**Retry click-through rate** = (number of times users click "Coba lagi" or retry button after error state) / (number of times error state is shown)

This directly measures whether the improved error classification leads to more successful recovery actions.

## Secondary Metrics

1. **Error state dismissal rate** = (users who navigate away from error screen without retrying) — inverse of engagement
2. **Time spent in error state** — longer time may indicate users reading the message
3. **Subsequent session re-entry rate** — do users return to club screen after error?

## Guardrail Metrics

1. **No increase in "missing" state exits** — we don't want users to think clubs are gone when they're just temporarily unavailable
2. **No regression in "ready" state time** — error handling shouldn't slow down successful club loads

## Sample Size Calculation

Using Evan Miller's calculator with these parameters:
- Baseline retry CTR (Variant A): estimated 8% (based on current error handling)
- Minimum Detectable Effect: 15% relative lift → 9.2% CTR in Variant B
- Statistical significance: 95% (p < 0.05)
- Power: 80%
- Traffic split: 50/50

**Required sample**: ~1,150 users per variant (2,300 total)
**Test duration**: 2 weeks at current traffic volume, or until 1,200+ conversions per variant

## Traffic Allocation

- **50/50 split** between Variant A and Variant B
- **Consistent assignment**: Users see same variant on return visits (stored in AsyncStorage with expiry)
- **Balanced exposure** across time of day/week

## Implementation Approach

### Server-Side Variant Determination

The variant will be determined server-side before rendering the ClubScreen, using a simple feature flag service or Supabase edge function. This avoids flicker and ensures consistent variant assignment.

```typescript
// Example: variant service
import { createClient } from '@supabase/supabase-js'

const supa = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!
)

async function getClubVariant(userId: string): Promise<'A' | 'B'> {
  const { data } = await supa
    .from('experiment_club_states')
    .select('variant')
    .eq('user_id', userId)
    .single()
  
  // Hash userId to assign consistent variant
  if (!data) {
    // Default: 50/50 split for new users
    const hash = userId.split('').reduce((a, b) => a + b.charCodeAt(0), 0)
    return hash % 2 === 0 ? 'A' : 'B'
  }
  return data.variant
}
```

### Variant Rendering in ClubScreen

```typescript
// In ClubScreen component
import { getClubVariant } from '@/lib/experiment-variant'

const variant = await getClubVariant(auth.uid())

// ... existing state logic ...

// Render variant-specific error messages
if (state === 'error') {
  if (isFetchFailure(error)) {
    // Network error - show recovery messaging
    if (variant === 'B') {
      return <View><Text>Gagal memuat klub. <Button title="Coba lagi" onPress={retry} /></Text></View>
    }
    return <View><Text>Gagal memuat klub. Silakan coba lagi nanti.</Text></View>
  }
  // not_found error
  if (variant === 'B') {
    return <View><Text>Klub tidak ditemukan. <Button title="Cari klub lain" onPress={navigateToClubs} /></Text></View>
  }
  return <View><Text>Klub tidak ditemukan. Silakan cari klub lain.</Text></View>
}
```

## Test Execution Checklist

### Pre-Launch
- [ ] Hypothesis documented (above)
- [ ] Primary metric defined (retry CTR)
- [ ] Sample size calculated (~1,150 per variant)
- [ ] Variants implemented correctly in club.tsx
- [ ] Tracking verified — retry clicks are captured in analytics
- [ ] QA completed on all variants across iOS and Android

### During the Test (2 weeks)
- [ ] Monitor for technical issues (no crashes on error state)
- [ ] Check segment quality (new vs. returning users, iOS vs. Android)
- [ ] Document external factors (app store updates, server maintenance)
- **DO NOT**: Peek at results and stop early
- **DO NOT**: Change variants mid-test
- **DO NOT**: Add traffic from new sources

### Post-Test Analysis
- [ ] Check if sample size was reached
- [ ] Check statistical significance (95% confidence)
- [ ] Compare effect size to MDE (15% lift)
- [ ] Check secondary metrics for context
- [ ] Check guardrail metrics (no negative side effects)
- [ ] Segment differences (iOS vs. Android, new vs. returning)
- [ ] Document decision and learnings

## Expected Outcomes

| Result | Conclusion |
|--------|------------|
| **Significant winner** (retry CTR improves by 15%+) | Implement Variant B permanently; update error handling pattern across other screens |
| **Significant loser** (no improvement or regression) | Keep Variant A; analyze why improved classification didn't translate to more retries |
| **No significant difference** | Test underpowered or effect too small; consider bolder change or more traffic |
| **Mixed signals** (guardrails concerned) | Dig deeper by segment (e.g., works for new users but not returning) |

## References

- Hypothesis framework from ab-test-setup SKILL.md
- Sample size calculations: Evan Miller's calculator
- Error classification: `isFetchFailure` from `src/features/auth/errors.ts`
- Club screen states: `src/app/club.tsx`