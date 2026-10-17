import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
// DTOs generated from src/prisma/contract.prisma (Prisma 8) — see README.
import { CreateUserDto, UpdateUserDto, User } from '../../generated/index.js';

/** In-memory stand-in: the spike validates DTO generation, not persistence. */
const users: User[] = [];

@ApiTags('users')
@Controller('users')
export class UsersController {
    @Get()
    @ApiOkResponse({ type: User, isArray: true })
    list(): User[] {
        return users;
    }

    @Post()
    @ApiOkResponse({ type: User })
    create(@Body() dto: CreateUserDto): User {
        const user = { posts: [], ...dto, id: users.length + 1, createdAt: new Date(), updatedAt: new Date() } as unknown as User;
        users.push(user);
        return user;
    }

    @Patch(':id')
    @ApiOkResponse({ type: User })
    update(@Param('id') id: string, @Body() dto: UpdateUserDto): User | undefined {
        const user = users.find((u) => u.id === Number(id));
        if (user) Object.assign(user, dto);
        return user;
    }
}
