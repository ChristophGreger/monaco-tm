import { render, screen } from '@testing-library/react';
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
});
