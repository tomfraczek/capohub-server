// Purely organizational at this stage - no public group directory/search
// exists yet, so this has no effect on authorization (GET /groups/:id always
// requires an active membership regardless of visibility). Reserved for a
// future public groups catalogue.
export enum GroupVisibility {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}
