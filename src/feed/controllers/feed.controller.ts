import { Controller, Get, Query, Request } from '@nestjs/common';
import { FeedService } from '../services/feed.service';
import { FeedRequestDto, FeedResponseDto } from '../dtos/feed.dto';

@Controller('feed')
export class FeedController {
  constructor(private readonly feedService: FeedService) {}

  @Get()
  async getFeed(@Query() query: any, @Request() req: any): Promise<FeedResponseDto> {
    const userId = req.user?.id || 'temp-user-id'; // TODO: Get from authenticated user
    
    const feedRequest: FeedRequestDto = {
      cursor: query.cursor,
      limit: query.limit ? parseInt(query.limit, 10) : 10,
      type: query.type || 'all',
    };

    return this.feedService.getFeedForUser(userId, feedRequest);
  }

  @Get('connections')
  async getConnectionsFeed(@Query() query: any, @Request() req: any): Promise<FeedResponseDto> {
    const userId = req.user?.id || 'temp-user-id';
    
    const feedRequest: FeedRequestDto = {
      cursor: query.cursor,
      limit: query.limit ? parseInt(query.limit, 10) : 10,
      type: 'connections',
    };

    return this.feedService.getFeedForUser(userId, feedRequest);
  }

  @Get('trending')
  async getTrendingFeed(@Query() query: any): Promise<FeedResponseDto> {
    const feedRequest: FeedRequestDto = {
      cursor: query.cursor,
      limit: query.limit ? parseInt(query.limit, 10) : 10,
      type: 'trending',
    };

    return this.feedService.getFeedForUser('temp-user-id', feedRequest);
  }
}
