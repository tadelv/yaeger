export function getFormattedTimeDifference(date1: Date, date2: Date): string {
    // Get the difference in milliseconds
    const difference = Math.abs(date2.getTime() - date1.getTime());

    // Convert milliseconds to total seconds
    const totalSeconds = Math.floor(difference / 1000);

    // Extract minutes and seconds
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    // Format with leading zeros
    const formattedMinutes = String(minutes).padStart(2, '0');
    const formattedSeconds = String(seconds).padStart(2, '0');

    return `${formattedMinutes}:${formattedSeconds}`;
}
