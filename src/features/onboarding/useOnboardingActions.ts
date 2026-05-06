import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { OnboardingActions } from './onboardingConstants';
import { markDemoTourDone } from './onboardingConstants';

export interface OnboardingState {
  navigate: ReturnType<typeof useNavigate>;
  loading: boolean;
  displayedStep: number;
  transitioning: boolean;
  handleSkipSetup: () => void;
}

export function useOnboardingActions(props: OnboardingActions): OnboardingState {
  const { step, complete, demoMode } = props;
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [displayedStep, setDisplayedStep] = useState(step);
  const transitioning = step !== displayedStep;

  useEffect(() => {
    if (step === displayedStep) return;
    const timer = setTimeout(() => setDisplayedStep(step), 200);
    return () => clearTimeout(timer);
  }, [step, displayedStep]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  function handleSkipSetup() {
    setLoading(true);
    if (demoMode) markDemoTourDone();
    complete();
    setLoading(false);
  }

  return {
    navigate,
    loading,
    displayedStep,
    transitioning,
    handleSkipSetup,
  };
}
