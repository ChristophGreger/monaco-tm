import { fireEvent, render, screen } from '@testing-library/react';
import App from './App';

vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco-editor" />,
}));

describe('App', () => {
  it('renders the load button and Monaco editor', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: 'Load' })).toBeInTheDocument();
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
  });

  it('parses the current editor contents when Load is clicked', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));

    expect(consoleSpy).toHaveBeenCalledWith(
      'Parsed TuringViz machine:',
      expect.objectContaining({
        machine: expect.objectContaining({
          tapes: 4,
          start: 'q0',
        }),
      }),
    );

    consoleSpy.mockRestore();
  });
});
