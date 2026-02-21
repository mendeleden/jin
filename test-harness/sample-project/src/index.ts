import { add, subtract, multiply, divide, fibonacci } from "./math";

const a = 10;
const b = 3;

console.log(`${a} + ${b} = ${add(a, b)}`);
console.log(`${a} - ${b} = ${subtract(a, b)}`);
console.log(`${a} * ${b} = ${multiply(a, b)}`);
console.log(`${a} / ${b} = ${divide(a, b)}`);
console.log(`fibonacci(10) = ${fibonacci(10)}`);
