import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CreatePostDto, Post as PostEntity } from '../../generated/index.js';

const posts: PostEntity[] = [];

@ApiTags('posts')
@Controller('posts')
export class PostsController {
    @Get()
    @ApiOkResponse({ type: PostEntity, isArray: true })
    list(): PostEntity[] {
        return posts;
    }

    @Post()
    @ApiOkResponse({ type: PostEntity })
    create(@Body() dto: CreatePostDto): PostEntity {
        const post = { ...dto, id: posts.length + 1, createdAt: new Date() } as unknown as PostEntity;
        posts.push(post);
        return post;
    }
}
