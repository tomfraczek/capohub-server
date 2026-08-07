// Request-only discriminant (never persisted) for how far a mutation on a
// recurring Training should reach - see the module spec §8/§19.
//
//  - THIS: only the single addressed Training.
//  - THIS_AND_FOLLOWING: the addressed Training and every future, not-yet-
//    started Training in the same TrainingSeries from its `startsAt`
//    onward (see TrainingsService.updateScoped/cancelScoped).
//
// ALL is deliberately not a value here: it is reached through
// TrainingSeries' own PATCH/cancel endpoints instead (see
// TrainingSeriesService), which always apply to the whole future,
// not-yet-started tail of the series - there is no specific "this" Training
// to anchor an ALL request to.
export enum TrainingEditScope {
  THIS = 'THIS',
  THIS_AND_FOLLOWING = 'THIS_AND_FOLLOWING',
}
