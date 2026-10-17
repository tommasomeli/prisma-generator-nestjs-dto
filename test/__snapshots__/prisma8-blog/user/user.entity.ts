import { Role } from '../enums';
import { Post } from '../post';
import { ApiProperty } from '@nestjs/swagger';

export class User {
	@ApiProperty({ type: 'number', required: true, format: 'int32' })
	 id!: number;

	@ApiProperty({ type: 'string', required: true })
	 email!: string;

	@ApiProperty({ type: 'string', required: true })
	 name!: string;

	@ApiProperty({ enum: Role, enumName: 'Role', required: true, default: 'USER' })
	 role?: Role = Role.USER;

	@ApiProperty({ type: 'string', required: false, nullable: true })
	 bio?: string | null;

	@ApiProperty({ type: () => Post, isArray: true, required: false, nullable: true })
	 posts?: Post[] | null;

	@ApiProperty({ type: () => Date, required: true, format: 'date-time' })
	 createdAt!: Date;

	@ApiProperty({ type: () => Date, required: true, format: 'date-time' })
	 updatedAt!: Date;
}