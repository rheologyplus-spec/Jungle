export const GRID_SIZE = 10;
export const ROUND_SECONDS = 120;
export const FIND_TIME_BONUS = 5;

export const ANIMALS = [
  { name: "روباه", english: "FOX" },
  { name: "جغد برفی", english: "OWL" },
  { name: "خرس", english: "BEAR" },
  { name: "ببر", english: "TIGER" },
  { name: "پاندای قرمز", english: "RED PANDA" },
  { name: "گوزن", english: "DEER" },
  { name: "راکون", english: "RACCOON" },
  { name: "خرگوش", english: "RABBIT" },
] as const;

export type Cell = {
  animalId: number | null;
  adjacent: number;
  revealed: boolean;
  marked: boolean;
  revealDelay: number;
  source: "tap" | "cross" | null;
};

type Position = { row: number; col: number };

export function blankBoard(): Cell[] {
  return Array.from({ length: GRID_SIZE * GRID_SIZE }, () => ({
    animalId: null,
    adjacent: 0,
    revealed: false,
    marked: false,
    revealDelay: 0,
    source: null,
  }));
}

function shuffled<T>(values: T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function isInClearZone(index: number, animalIndex: number): boolean {
  const row = Math.floor(index / GRID_SIZE);
  const col = index % GRID_SIZE;
  const animalRow = Math.floor(animalIndex / GRID_SIZE);
  const animalCol = animalIndex % GRID_SIZE;

  return (
    row === animalRow ||
    col === animalCol ||
    (Math.abs(row - animalRow) <= 1 && Math.abs(col - animalCol) <= 1)
  );
}

function countNeighbors(board: Cell[], index: number): number {
  const row = Math.floor(index / GRID_SIZE);
  const col = index % GRID_SIZE;
  let count = 0;

  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let colOffset = -1; colOffset <= 1; colOffset += 1) {
      if (rowOffset === 0 && colOffset === 0) continue;
      const nextRow = row + rowOffset;
      const nextCol = col + colOffset;
      if (nextRow < 0 || nextRow >= GRID_SIZE || nextCol < 0 || nextCol >= GRID_SIZE) continue;
      if (board[nextRow * GRID_SIZE + nextCol].animalId !== null) count += 1;
    }
  }

  return count;
}

function withNeighborCounts(board: Cell[]): Cell[] {
  return board.map((cell, index) => ({
    ...cell,
    adjacent: cell.animalId === null ? countNeighbors(board, index) : 0,
  }));
}

// A fixed first portrait makes the first tap rewarding; backtracking keeps every
// other portrait out of its row, column, and all eight neighboring cells.
export function createBoard(firstIndex: number, previous: Cell[]): Cell[] {
  const firstRow = Math.floor(firstIndex / GRID_SIZE);
  const firstCol = firstIndex % GRID_SIZE;
  const allColumns = Array.from({ length: GRID_SIZE }, (_, index) => index);
  const otherRows = Array.from({ length: GRID_SIZE }, (_, index) => index).filter(
    (row) => row !== firstRow,
  );

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const rows = [firstRow, ...shuffled(otherRows).slice(0, ANIMALS.length - 1)].sort(
      (a, b) => a - b,
    );
    const positions: Position[] = [{ row: firstRow, col: firstCol }];
    const usedColumns = new Set([firstCol]);

    const placeNext = (rowIndex: number): boolean => {
      if (rowIndex === rows.length) return true;
      const row = rows[rowIndex];
      if (row === firstRow) return placeNext(rowIndex + 1);

      for (const col of shuffled(allColumns)) {
        if (usedColumns.has(col)) continue;
        if (
          positions.some(
            (position) =>
              Math.abs(position.row - row) <= 1 && Math.abs(position.col - col) <= 1,
          )
        ) {
          continue;
        }

        positions.push({ row, col });
        usedColumns.add(col);
        if (placeNext(rowIndex + 1)) return true;
        positions.pop();
        usedColumns.delete(col);
      }

      return false;
    };

    if (!placeNext(0)) continue;

    const board = blankBoard();
    const animalOrder = shuffled(ANIMALS.map((_, index) => index));
    positions.forEach(({ row, col }, index) => {
      board[row * GRID_SIZE + col].animalId = animalOrder[index];
    });
    previous.forEach((cell, index) => {
      board[index].marked = cell.marked;
    });
    return withNeighborCounts(board);
  }

  throw new Error("Could not create a valid animal board.");
}

export function revealAnimal(board: Cell[], index: number): Cell[] {
  const animalRow = Math.floor(index / GRID_SIZE);
  const animalCol = index % GRID_SIZE;

  return board.map((cell, cellIndex) => {
    if (cell.revealed || !isInClearZone(cellIndex, index)) return cell;
    if (cellIndex !== index && cell.animalId !== null) return cell;

    const row = Math.floor(cellIndex / GRID_SIZE);
    const col = cellIndex % GRID_SIZE;
    const distance = Math.max(Math.abs(row - animalRow), Math.abs(col - animalCol));

    return {
      ...cell,
      revealed: true,
      marked: false,
      revealDelay: cellIndex === index ? 0 : 55 + Math.min(distance, 7) * 42,
      source: cellIndex === index ? "tap" : "cross",
    };
  });
}

export function createPreviewBoard(): Cell[] {
  const board = blankBoard();
  board[14].animalId = 1;
  board[45].animalId = 0;
  board[78].animalId = 7;
  const counted = withNeighborCounts(board);

  return counted.map((cell, index) => ({
    ...cell,
    revealed: cell.animalId !== null || isInClearZone(index, 45),
    source: cell.animalId !== null ? "tap" : "cross",
  }));
}