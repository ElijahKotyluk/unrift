import { getUser } from "./user-service";

export const greet = (id: number) => `hi ${getUser(id).name}`;
