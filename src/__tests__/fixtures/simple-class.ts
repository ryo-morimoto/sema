export class Calculator {
  value: number;

  constructor() {
    this.value = 0;
  }

  add(n: number): void {
    this.value += n;
  }

  reset(): void {
    this.value = 0;
  }
}
