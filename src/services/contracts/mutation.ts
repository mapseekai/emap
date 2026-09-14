/** Explicit service contract. Providers implement this boundary; consumers do not import implementations. */
export interface MutationContract {
  deleteSelected(): boolean;
}
