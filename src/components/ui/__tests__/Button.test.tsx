import { fireEvent, render, screen } from '@testing-library/react-native';

import { Button } from '@/components/ui/Button';

describe('Button', () => {
  it('memanggil onPress ketika ditekan', async () => {
    const onPress = jest.fn();
    await render(<Button label="Mulai" onPress={onPress} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Mulai' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('menonaktifkan tombol dan mengumumkannya ke screen reader', async () => {
    const onPress = jest.fn();
    await render(<Button disabled label="Buat perjalanan" onPress={onPress} />);

    const button = screen.getByRole('button', { name: 'Buat perjalanan' });

    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleName('Buat perjalanan');
    expect(button).toHaveProp('accessibilityState', { disabled: true });

    await fireEvent.press(button);

    expect(onPress).not.toHaveBeenCalled();
  });

  it('tetap merender label meski tidak punya handler', async () => {
    await render(<Button label="Fitur mendatang" />);

    expect(screen.getByText('Fitur mendatang')).toBeTruthy();
  });
});
