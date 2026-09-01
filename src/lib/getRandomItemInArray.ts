export function getRandomItemInArray<T>(array: T[]) {
    // Source - https://stackoverflow.com/a/4550514
    const randomElement = array[Math.floor(Math.random() * array.length)];
    return randomElement;
}
