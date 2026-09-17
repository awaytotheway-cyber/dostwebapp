import React from 'react';
import CountryPicker from '../CountryPicker';

type Props = {
  value: string;
  onChange: (country: string) => void;
};

export default function OnboardingCountryPicker({ value, onChange }: Props) {
  return <CountryPicker value={value} onChange={onChange} appearance="onboarding" />;
}
