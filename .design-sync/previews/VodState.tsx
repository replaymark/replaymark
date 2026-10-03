import { VodState } from '@replaymark/ds';

export const AllStates = () => (
  <div className="flex flex-col gap-3">
    <VodState state="available" />
    <VodState state="pending" />
    <VodState state="none" />
    <VodState state="likely_expired" />
  </div>
);
