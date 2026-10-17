import type { JsonValue } from '@prisma/orm-framework/utils/json';
import { User } from '../user';
import { ApiProperty } from '@nestjs/swagger';

export class Post {
	@ApiProperty({ type: 'number', required: true, format: 'int32' })
	 id!: number;

	@ApiProperty({ type: 'string', required: true })
	 title!: string;

	@ApiProperty({ type: 'string', required: true })
	 body!: string;

	@ApiProperty({ type: 'string', required: true, format: 'decimal' })
	 score!: string;

	@ApiProperty({ type: () => Object, required: false, nullable: true })
	 meta?: JsonValue | null;

	@ApiProperty({ type: () => User, required: true })
	 author!: User;

	@ApiProperty({ type: 'number', required: true, format: 'int32' })
	 authorId!: number;

	@ApiProperty({ type: () => Date, required: true, format: 'date-time' })
	 createdAt!: Date;
}