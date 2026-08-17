import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  Accordion,
  AccordionContent,
  AccordionDetails,
  AccordionItem,
  AccordionRoot,
  AccordionSummary,
  AccordionTrigger,
} from '@/atoms/primitives/Accordion.js';

describe('Accordion', () => {
  it('reports controlled changes and keeps summary and details accessibility in sync', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Accordion expanded={false} onChange={onChange} className="host-accordion" data-testid="accordion">
        <AccordionSummary>Account settings</AccordionSummary>
        <AccordionDetails>Profile details</AccordionDetails>
      </Accordion>,
    );

    const accordion = screen.getByTestId('accordion');
    const summary = screen.getByRole('button', { name: 'Account settings' });
    expect(accordion).toHaveClass('w-full', 'host-accordion');
    expect(accordion).not.toHaveAttribute('data-expanded');
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(summary).toHaveAttribute('aria-controls');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();

    fireEvent.click(summary);
    expect(onChange).toHaveBeenCalledWith(expect.any(Object), true);

    rerender(
      <Accordion expanded onChange={onChange} className="host-accordion" data-testid="accordion">
        <AccordionSummary>Account settings</AccordionSummary>
        <AccordionDetails>Profile details</AccordionDetails>
      </Accordion>,
    );

    const region = screen.getByRole('region');
    expect(accordion).toHaveAttribute('data-expanded', 'true');
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    expect(region).toHaveTextContent('Profile details');
    expect(region).toHaveAttribute('id', summary.getAttribute('aria-controls'));

    fireEvent.click(summary);
    expect(onChange).toHaveBeenLastCalledWith(expect.any(Object), false);
  });
});

describe('AccordionRoot', () => {
  it('opens, switches, and closes items in single mode', () => {
    render(
      <AccordionRoot defaultValue="profile" className="host-root">
        <AccordionItem value="profile">
          <AccordionTrigger data-track="profile">Profile</AccordionTrigger>
          <AccordionContent>Profile panel</AccordionContent>
        </AccordionItem>
        <AccordionItem value="security">
          <AccordionTrigger>Security</AccordionTrigger>
          <AccordionContent>Security panel</AccordionContent>
        </AccordionItem>
      </AccordionRoot>,
    );

    const profile = screen.getByRole('button', { name: 'Profile' });
    const security = screen.getByRole('button', { name: 'Security' });
    expect(profile).toHaveAttribute('data-track', 'profile');
    expect(profile).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region')).toHaveTextContent('Profile panel');

    fireEvent.click(security);
    expect(profile).toHaveAttribute('aria-expanded', 'false');
    expect(security).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByText('Profile panel')).not.toBeInTheDocument();
    expect(screen.getByRole('region')).toHaveTextContent('Security panel');
    expect(screen.getByRole('region')).toHaveAttribute('id', security.getAttribute('aria-controls'));

    fireEvent.click(security);
    expect(security).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('keeps independently toggled items open in multiple mode', () => {
    render(
      <AccordionRoot type="multiple">
        <AccordionItem value="first">
          <AccordionTrigger>First</AccordionTrigger>
          <AccordionContent>First panel</AccordionContent>
        </AccordionItem>
        <AccordionItem value="second">
          <AccordionTrigger>Second</AccordionTrigger>
          <AccordionContent>Second panel</AccordionContent>
        </AccordionItem>
      </AccordionRoot>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'First' }));
    fireEvent.click(screen.getByRole('button', { name: 'Second' }));
    expect(screen.getAllByRole('region')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'First' }));
    expect(screen.queryByText('First panel')).not.toBeInTheDocument();
    expect(screen.getByText('Second panel')).toBeInTheDocument();
  });
});
